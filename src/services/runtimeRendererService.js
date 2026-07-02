import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import {
  FrameworkPackage,
  RuntimeActivationSnapshot,
  RuntimeDeployment,
  RuntimeInstance,
  RuntimePathRegistry,
  AuditLog,
  UIContract,
  WorkflowPolicy,
} from '../models/index.js'
import { FRAMEWORK_PACKAGE_STATUSES } from '../models/FrameworkPackage.js'
import { RUNTIME_ACTIVATION_STATUSES } from '../models/RuntimeActivationSnapshot.js'
import { RUNTIME_DEPLOYMENT_STATUSES } from '../models/RuntimeDeployment.js'
import {
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_STATUSES,
  RUNTIME_PATH_REGISTRY_UI_CONTROLS,
} from '../models/RuntimePathRegistry.js'
import {
  RUNTIME_EXECUTION_STATUSES,
  RUNTIME_INSTANCE_STATUSES,
  RUNTIME_TYPES,
} from '../models/RuntimeInstance.js'
import {
  DISCOVERY_ACQUISITION_PROFILES,
  ENABLED_DISCOVERY_ACQUISITION_PROFILES,
} from '../constants/discoveryAcquisitionProfiles.js'
import { UI_CONTRACT_STATUSES } from '../models/UIContract.js'
import {
  WORKFLOW_POLICY_CONDITION_LOGIC,
  WORKFLOW_POLICY_CONDITION_OPERATORS,
  WORKFLOW_POLICY_DECISION_MODES,
  WORKFLOW_POLICY_STATUSES,
} from '../models/WorkflowPolicy.js'
import {
  applyRuntimeActionStateGate,
  deriveRuntimeReadinessState,
  isRuntimeLifecycleTruthImmutable,
  isRuntimeLocked,
  normalizeFrameworkStateForAction,
} from './runtimeActionPolicyService.js'
import { assertRuntimePermission, getRuntimeInstance } from './runtimeInstanceService.js'
import { evaluateRuntimeSectionTruthReadiness } from './runtimeSectionTruthReadinessService.js'
import {
  buildSectionIntelligenceDisplayProjection,
  getRuntimeSectionGenerated,
  getRuntimeSectionAccepted,
  getRuntimeSectionDependencies,
  getRuntimeSectionInput,
  getRuntimeSectionRevisions,
  getRuntimeSectionState,
  hashSectionInput,
  isRuntimeSectionObject,
} from './runtimeSectionModelService.js'
import {
  acceptPendingDiscoveryEvidenceObjects,
  buildDiscoveryAcquisitionEffectiveness,
  buildDiscoveryEvidenceReviewSummary,
  buildDiscoveryHealth,
  buildDiscoverySourceRegistry,
  DISCOVERY_EVIDENCE_REVIEW_STATUSES,
  normalizeDiscoveryEvidenceObjects,
} from './discoveryIntelligenceService.js'
import { buildRuntimeIntelligenceGraphProjection } from './runtimeIntelligenceGraphService.js'

export const RUNTIME_RENDERER_ERROR_REASONS = Object.freeze({
  PACKAGE_NOT_FOUND: 'PACKAGE_NOT_FOUND',
  PACKAGE_FRAMEWORK_MISMATCH: 'PACKAGE_FRAMEWORK_MISMATCH',
  PACKAGE_NOT_ACTIVE: 'PACKAGE_NOT_ACTIVE',
  DEPLOYMENT_SNAPSHOT_MISMATCH: 'DEPLOYMENT_SNAPSHOT_MISMATCH',
  UI_CONTRACT_REQUIRED: 'UI_CONTRACT_REQUIRED',
  UI_CONTRACT_NOT_FOUND: 'UI_CONTRACT_NOT_FOUND',
  DEAL_ANALYSIS_ANCHOR_REQUIRED: 'DEAL_ANALYSIS_ANCHOR_REQUIRED',
})

const CONFIG_WARNING_CODES = Object.freeze({
  PACKAGE_SECTION_MISSING_RUNTIME_PATH: 'PACKAGE_SECTION_MISSING_RUNTIME_PATH',
  RUNTIME_PATH_NOT_FOUND: 'RUNTIME_PATH_NOT_FOUND',
  RUNTIME_PATH_NOT_READABLE: 'RUNTIME_PATH_NOT_READABLE',
  UI_CONTRACT_SECTION_MISSING: 'UI_CONTRACT_SECTION_MISSING',
  UI_CONTRACT_SECTION_ORPHANED: 'UI_CONTRACT_SECTION_ORPHANED',
  ACTION_POLICY_MISSING: 'ACTION_POLICY_MISSING',
  POLICY_ACTION_MISSING: 'POLICY_ACTION_MISSING',
})

const RENDERER_WARNING_SEVERITIES = Object.freeze({
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  BLOCKER: 'BLOCKER',
})

const CONFIG_WARNING_SEVERITY_BY_CODE = Object.freeze({
  [CONFIG_WARNING_CODES.PACKAGE_SECTION_MISSING_RUNTIME_PATH]: RENDERER_WARNING_SEVERITIES.ERROR,
  [CONFIG_WARNING_CODES.RUNTIME_PATH_NOT_FOUND]: RENDERER_WARNING_SEVERITIES.ERROR,
  [CONFIG_WARNING_CODES.RUNTIME_PATH_NOT_READABLE]: RENDERER_WARNING_SEVERITIES.ERROR,
  [CONFIG_WARNING_CODES.UI_CONTRACT_SECTION_MISSING]: RENDERER_WARNING_SEVERITIES.WARNING,
  [CONFIG_WARNING_CODES.UI_CONTRACT_SECTION_ORPHANED]: RENDERER_WARNING_SEVERITIES.WARNING,
  [CONFIG_WARNING_CODES.ACTION_POLICY_MISSING]: RENDERER_WARNING_SEVERITIES.WARNING,
  [CONFIG_WARNING_CODES.POLICY_ACTION_MISSING]: RENDERER_WARNING_SEVERITIES.WARNING,
})

const VALUE_NOT_FOUND = Symbol('VALUE_NOT_FOUND')
const VMF_FRAMEWORK_KEY = 'VMF'
const LOCKED_RUNTIME_READONLY_REASON =
  'Runtime is locked and can only be inspected. Create a revision before changing discovery or section truth.'
const MUTATING_RUNTIME_ACTIONS = new Set([
  'APPROVE',
  'ARCHIVE',
  'ACCEPT_EVIDENCE',
  'BUILD_SECTIONS',
  'BUILD_EVIDENCE_PACK',
  'GENERATE_SECTION',
  'INITIALISE_STATE',
  'LOCK_RECORD',
  'MARK_READY',
  'PUBLISH',
  'REGENERATE_SECTION',
  'REFRESH_EVIDENCE_PACK',
  'RETURN_TO_DRAFT',
  'RUN_VALIDATION',
  'SAVE',
  'SAVE_DISCOVERY_INPUTS',
  'SAVE_DRAFT',
  'START_REVIEW',
  'SUBMIT_FOR_REVIEW',
])
const DEAL_ANALYSIS_ANCHOR_RELATIONSHIPS = new Set([
  'LOCKED_VMF_RUNTIME',
  'LOCKED_VALUE_NARRATIVE',
  'VALUE_NARRATIVE_ANCHOR',
])
const RENDERABLE_DEPLOYMENT_STATUSES = new Set([
  RUNTIME_DEPLOYMENT_STATUSES.ACTIVE,
  RUNTIME_DEPLOYMENT_STATUSES.ROLLBACK_ACTIVE,
  RUNTIME_DEPLOYMENT_STATUSES.SUPERSEDED,
])
const RENDERABLE_ACTIVATION_STATUSES = new Set([
  RUNTIME_ACTIVATION_STATUSES.ACTIVE,
  RUNTIME_ACTIVATION_STATUSES.SUPERSEDED,
])
export const RUNTIME_RENDERER_CONTRACT_VERSION = 'runtime-renderer.v1.read-projection'
const RUNTIME_ACTIVITY_LIMIT = 10
const RUNTIME_ACTIVITY_RESOURCE_TYPE = 'RuntimeInstance'
const RUNTIME_ACTIVITY_SUMMARY_BY_ACTION = Object.freeze({
  RUNTIME_INSTANCE_CREATED: 'Runtime instance created',
  RUNTIME_REVISION_CREATED: 'Runtime revision created',
  RUNTIME_STATE_MUTATED: 'Runtime state updated',
  RUNTIME_ACTION_EXECUTED: 'Runtime action executed',
})

const toPlainObject = (value) => {
  if (!value) return null
  if (typeof value.toJSON === 'function') return value.toJSON()
  if (typeof value.toObject === 'function') return value.toObject()
  return { ...value }
}

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (value._id && value._id !== value) return toIdString(value._id)
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const normalizeToken = (value) => String(value || '').trim().toUpperCase()
const normalizeKey = (value) => String(value || '').trim().toLowerCase()
const parseRuntimeTimestamp = (value) => {
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}
const uniqueTokens = (values = []) => [...new Set(
  (Array.isArray(values) ? values : [])
    .map(normalizeToken)
    .filter(Boolean),
)]

const createRuntimeRendererError = ({
  status,
  code,
  message,
  reason,
  details = {},
}) => {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.details = {
    reason,
    ...details,
  }
  return err
}

const createConfigWarning = ({
  code,
  message,
  severity,
  sectionKey,
  runtimePath,
  actionKey,
  governedAction,
  policyKey,
}) => ({
  code,
  severity: severity || CONFIG_WARNING_SEVERITY_BY_CODE[code] || RENDERER_WARNING_SEVERITIES.WARNING,
  message,
  ...(sectionKey ? { sectionKey } : {}),
  ...(runtimePath ? { runtimePath } : {}),
  ...(actionKey ? { actionKey } : {}),
  ...(governedAction ? { governedAction } : {}),
  ...(policyKey ? { policyKey } : {}),
})

const getValueAtPath = (source, path) => {
  const parts = String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return VALUE_NOT_FOUND

  let cursor = source
  for (const part of parts) {
    if (
      cursor === null
      || cursor === undefined
      || typeof cursor !== 'object'
      || !Object.prototype.hasOwnProperty.call(cursor, part)
    ) {
      return VALUE_NOT_FOUND
    }
    cursor = cursor[part]
  }

  return cursor
}

const getRuntimePathValue = (frameworkState, runtimePath) => {
  const normalizedPath = String(runtimePath || '').trim()
  if (!normalizedPath.startsWith('framework_state.')) return undefined

  const value = getValueAtPath(
    { framework_state: frameworkState || {} },
    normalizedPath,
  )

  return value === VALUE_NOT_FOUND ? undefined : value
}

const titleFromKey = (key) =>
  String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())

const cloneProjectionValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const isEmptyProjectionValue = (value) => {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

const hasProjectionValue = (value) => !isEmptyProjectionValue(value)

const isProjectionObject = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const SECTION_EVIDENCE_SOURCE_TYPE = 'SECTION_UPLOADED_DOCUMENT'
const SECTION_EVIDENCE_SNIPPET_MAX_LENGTH = 120

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

const buildSectionEvidenceProjection = (rawSectionValue) => {
  if (!isRuntimeSectionObject(rawSectionValue)) {
    return {
      status: 'EMPTY',
      documentCount: 0,
      evidenceObjectCount: 0,
      acceptedEvidenceObjectCount: 0,
      pendingEvidenceObjectCount: 0,
      rejectedEvidenceObjectCount: 0,
      documents: [],
      evidenceObjects: [],
    }
  }

  const additionalEvidence = isProjectionObject(rawSectionValue.additionalEvidence)
    ? rawSectionValue.additionalEvidence
    : {}
  const documents = Array.isArray(additionalEvidence.documents) ? additionalEvidence.documents : []
  const evidenceObjects = Array.isArray(rawSectionValue.evidenceObjects) ? rawSectionValue.evidenceObjects : []
  const reviewCounts = evidenceObjects.reduce((acc, evidenceObject) => {
    const reviewStatus = normalizeSectionEvidenceReviewStatus(evidenceObject?.reviewStatus)
    if (reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.ACCEPTED) acc.acceptedEvidenceObjectCount += 1
    else if (reviewStatus === DISCOVERY_EVIDENCE_REVIEW_STATUSES.REJECTED) acc.rejectedEvidenceObjectCount += 1
    else acc.pendingEvidenceObjectCount += 1
    return acc
  }, {
    acceptedEvidenceObjectCount: 0,
    pendingEvidenceObjectCount: 0,
    rejectedEvidenceObjectCount: 0,
  })
  const evidenceObjectCount = evidenceObjects.length

  return {
    status: String(additionalEvidence.status || (
      evidenceObjectCount === 0
        ? 'EMPTY'
        : reviewCounts.pendingEvidenceObjectCount > 0
          ? 'PENDING_REVIEW'
          : reviewCounts.acceptedEvidenceObjectCount > 0
            ? 'ACCEPTED'
            : 'REJECTED'
    )).trim().toUpperCase(),
    updatedAt: String(additionalEvidence.updatedAt || '').trim(),
    updatedBy: String(additionalEvidence.updatedBy || '').trim(),
    documentCount: Number.isFinite(Number(additionalEvidence.documentCount))
      ? Number(additionalEvidence.documentCount)
      : documents.length,
    evidenceObjectCount,
    ...reviewCounts,
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
    evidenceObjects: evidenceObjects.map((evidenceObject) => ({
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

const redactReadOnlySectionIntelligence = (intelligence) => {
  if (!isProjectionObject(intelligence)) return intelligence
  const redacted = cloneProjectionValue(intelligence)

  if (isProjectionObject(redacted.sourceProjection)) {
    redacted.sourceProjection = {
      ...redacted.sourceProjection,
      themes: Array.isArray(redacted.sourceProjection.themes)
        ? redacted.sourceProjection.themes.map((theme) => ({
            key: theme?.key || '',
            label: theme?.label || '',
            source: theme?.source || '',
            supportLevel: theme?.supportLevel || '',
            confidence: theme?.confidence || '',
            claimClassification: theme?.claimClassification || '',
          }))
        : [],
    }
  }

  if (isProjectionObject(redacted.scopedEvidence)) {
    redacted.scopedEvidence = {
      ...redacted.scopedEvidence,
      sourceRefs: Array.isArray(redacted.scopedEvidence.sourceRefs)
        ? redacted.scopedEvidence.sourceRefs.map((ref) => ({
            refKey: ref?.refKey || '',
            label: ref?.label || '',
            type: ref?.type || '',
          }))
        : [],
    }
  }

  redacted.supportingEvidence = []

  if (isProjectionObject(redacted.displayProjection)) {
    redacted.displayProjection = {
      ...redacted.displayProjection,
      generatedInsight: isProjectionObject(redacted.displayProjection.generatedInsight)
        ? {
            title: redacted.displayProjection.generatedInsight.title || 'Generated Insight',
            summary: redacted.displayProjection.generatedInsight.summary
              ? 'Generated section intelligence is available.'
              : '',
            sections: [],
          }
        : redacted.displayProjection.generatedInsight,
      supportingEvidence: {
        title: 'Supporting Evidence',
        items: [],
      },
    }
  }

  return redacted
}

const getDiscoveryEvidencePack = (frameworkState = {}) =>
  frameworkState.evidence_pack || frameworkState.evidencePack || null

const isStrictTrue = (value) => value === true

const normalizeRendererAcquisitionProfile = (value) => {
  const profile = String(value || '').trim().toUpperCase()
  return ENABLED_DISCOVERY_ACQUISITION_PROFILES.includes(profile)
    ? profile
    : DISCOVERY_ACQUISITION_PROFILES.STANDARD
}

const stripRendererContradictionClaims = (discoveryHealth = {}) => {
  if (!discoveryHealth || typeof discoveryHealth !== 'object' || Array.isArray(discoveryHealth)) {
    return {}
  }

  const projection = cloneProjectionValue(discoveryHealth)
  if (Array.isArray(projection.contradictionCandidates)) {
    projection.contradictionCandidates = projection.contradictionCandidates.map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
      const safeCandidate = { ...candidate }
      delete safeCandidate.claimA
      delete safeCandidate.claimB
      return safeCandidate
    })
  }
  return projection
}

const buildProjectionSummary = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      keys: [],
      count: 0,
    }
  }

  const keys = Object.keys(value).filter(Boolean)
  return {
    keys,
    count: keys.length,
  }
}

const buildAcceptedDiscoveryCoverageProjection = (coverage = {}) => {
  if (!isProjectionObject(coverage)) return coverage

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

const normalizeDiscoveryStateStatus = ({
  accepted,
  evidenceReady,
  explicitStatus,
  inputComplete,
  needsRefresh,
}) => {
  const status = normalizeToken(explicitStatus)
  if (needsRefresh) return 'NEEDS_REFRESH'
  if (accepted) return 'ACCEPTED'
  if (evidenceReady) return 'EVIDENCE_READY'
  if (inputComplete) return 'INPUT_COMPLETE'
  if (status && !['ACCEPTED', 'EVIDENCE_ACCEPTED', 'EVIDENCE_READY', 'INPUT_COMPLETE'].includes(status)) return status
  return 'EVIDENCE_NOT_READY'
}

export const buildDiscoveryProjection = (frameworkState = {}, { includeInputValues = false } = {}) => {
  const evidencePack = getDiscoveryEvidencePack(frameworkState)
  if (!evidencePack || typeof evidencePack !== 'object' || Array.isArray(evidencePack)) {
    return {
      state: {
        status: 'EVIDENCE_NOT_READY',
      },
      inputComplete: false,
      evidenceReady: false,
      accepted: false,
      needsRefresh: false,
      scopedViews: {},
      ...(includeInputValues ? { inputValues: {} } : {}),
    }
  }

  const scopedViews = evidencePack.scoped_views || evidencePack.scopedViews || {}
  const summaries = evidencePack.summaries || {}
  const inputComplete = isStrictTrue(evidencePack.inputComplete)
    || isStrictTrue(evidencePack.input_complete)
    || isStrictTrue(evidencePack.inputs?.complete)
    || isStrictTrue(evidencePack.state?.inputComplete)
  const evidenceReady = isStrictTrue(evidencePack.evidenceReady)
    || isStrictTrue(evidencePack.evidence_ready)
    || isStrictTrue(evidencePack.state?.evidenceReady)
  const explicitStatus = evidencePack.state?.status || evidencePack.status
  const needsRefresh = isStrictTrue(evidencePack.needsRefresh)
    || isStrictTrue(evidencePack.needs_refresh)
    || isStrictTrue(evidencePack.state?.needsRefresh)
  const accepted = !needsRefresh && (
    isStrictTrue(evidencePack.accepted)
    || isStrictTrue(evidencePack.state?.accepted)
  )
  const inputSummary = buildProjectionSummary(evidencePack.inputs)
  const evidenceSummary = buildProjectionSummary(evidencePack.evidence)
  const summarySummary = buildProjectionSummary(summaries)
  const scopedViewSummary = buildProjectionSummary(scopedViews)
  const acquisition = evidencePack.acquisition && typeof evidencePack.acquisition === 'object' && !Array.isArray(evidencePack.acquisition)
    ? cloneProjectionValue(evidencePack.acquisition)
    : {}
  if (accepted && isProjectionObject(acquisition.coverage)) {
    acquisition.coverage = buildAcceptedDiscoveryCoverageProjection(acquisition.coverage)
  }
  const acquisitionProfile = normalizeRendererAcquisitionProfile(acquisition.profile || evidencePack.acquisitionProfile)
  if (acquisition && typeof acquisition === 'object' && !Array.isArray(acquisition)) {
    acquisition.profile = acquisitionProfile
  }
  const lineageSources = Array.isArray(evidencePack.lineage?.sources) ? evidencePack.lineage.sources : []
  const normalizedEvidenceObjects = normalizeDiscoveryEvidenceObjects({
    acquisitionProfile,
    createdAt: evidencePack.refreshedAt,
    evidenceObjects: evidencePack.evidenceObjects,
    inputs: evidencePack.inputs,
    sources: lineageSources,
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
    sources: lineageSources,
  })
  const discoveryHealth = sourceRegistry.length > 0 || evidenceObjects.length > 0
    ? buildDiscoveryHealth({
        acquisitionProfile,
        coverage: {
          ...(acquisition.coverage || evidencePack.evidence?.coverage || {}),
          confidence: acquisition.confidence || evidencePack.evidence?.confidence,
        },
        evidenceReady,
        evidenceObjects,
        lastAcquisitionDate: evidencePack.refreshedAt || acquisition.completedAt,
        needsRefresh,
        sourceRegistry,
      })
    : {}
  const acquisitionEffectiveness = sourceRegistry.length > 0 || evidenceObjects.length > 0
    ? buildDiscoveryAcquisitionEffectiveness({
        acquisitionProfile,
        discoveryHealth,
        evidenceObjects,
        inputs: evidencePack.inputs || {},
        sourceRegistry,
      })
    : cloneProjectionValue(evidencePack.acquisitionEffectiveness || acquisition.effectiveness || {})
  const intelligenceGraph = buildRuntimeIntelligenceGraphProjection(frameworkState.intelligence_graph)

  return {
    state: {
      ...(evidencePack.state && typeof evidencePack.state === 'object' && !Array.isArray(evidencePack.state)
        ? cloneProjectionValue(evidencePack.state)
        : {}),
      status: normalizeDiscoveryStateStatus({
        accepted,
        evidenceReady,
        explicitStatus,
        inputComplete,
        needsRefresh,
      }),
    },
    inputComplete,
    evidenceReady,
    accepted,
    needsRefresh,
    acquisitionProfile,
    acquisition,
    scopedViews: scopedViews && typeof scopedViews === 'object' && !Array.isArray(scopedViews)
      ? cloneProjectionValue(scopedViews)
      : {},
    inputSummary,
    evidenceSummary,
    summarySummary,
    scopedViewSummary,
    lineageSummary: {
      sourceCount: lineageSources.length,
      builderMode: evidencePack.lineage?.builder?.mode || '',
    },
    sourceRegistrySummary: {
      count: sourceRegistry.length,
      sourceTypes: Array.from(new Set(sourceRegistry.map((source) => source.sourceType).filter(Boolean))),
    },
    evidenceObjectSummary: buildDiscoveryEvidenceReviewSummary(evidenceObjects),
    discoveryHealth: stripRendererContradictionClaims(discoveryHealth),
    acquisitionEffectiveness: cloneProjectionValue(acquisitionEffectiveness),
    intelligenceGraph,
    ...(isProjectionObject(evidencePack.resetSummary) ? { resetSummary: cloneProjectionValue(evidencePack.resetSummary) } : {}),
    ...(includeInputValues ? { inputValues: cloneProjectionValue(evidencePack.inputs || {}) } : {}),
    ...(evidencePack.acceptedAt ? { acceptedAt: evidencePack.acceptedAt } : {}),
    ...(evidencePack.acceptedBy ? { acceptedBy: evidencePack.acceptedBy } : {}),
    ...(evidencePack.refreshedAt ? { refreshedAt: evidencePack.refreshedAt } : {}),
  }
}

export const getDependencySectionKeys = (packageSection = {}) => {
  const candidates = [
    packageSection.dependsOnSectionKeys,
    packageSection.dependencySectionKeys,
    packageSection.dependsOn,
  ]

  return candidates
    .flatMap((candidate) => (Array.isArray(candidate) ? candidate : [candidate]))
    .map((candidate) => {
      if (candidate && typeof candidate === 'object') {
        return normalizeKey(candidate.sectionKey || candidate.key)
      }
      return normalizeKey(candidate)
    })
    .filter(Boolean)
}

const hasSectionContextValue = (value) => {
  if (isRuntimeSectionObject(value)) {
    return hasProjectionValue(getRuntimeSectionInput(value))
      || hasProjectionValue(getRuntimeSectionGenerated(value)?.content ?? getRuntimeSectionGenerated(value))
  }

  return hasProjectionValue(value)
}

export const buildSectionGenerationEligibility = ({
  dependencySectionKeys,
  discovery,
  frameworkState,
  rawSectionValue,
}) => {
  const sources = []
  const sections = frameworkState.sections || {}

  if (discovery?.accepted === true) sources.push('DISCOVERY_ACCEPTED')
  if (hasSectionContextValue(rawSectionValue)) sources.push('SECTION_CONTEXT')

  const satisfiedDependencies = dependencySectionKeys.filter((sectionKey) =>
    hasSectionContextValue(sections[sectionKey]),
  )
  if (satisfiedDependencies.length > 0) sources.push('DEPENDENT_SECTION_CONTEXT')

  const canGenerate = discovery?.accepted === true
  return {
    canGenerate,
    reason: canGenerate
      ? ''
      : 'Accept Intelligence Hub evidence before generating this section.',
    sources,
    dependencySectionKeys,
    satisfiedDependencySectionKeys: satisfiedDependencies,
  }
}

const normalizeComparableSectionContent = (value) => {
  if (value === null || value === undefined) return ''
  const candidate = value?.content ?? value
  if (typeof candidate === 'string') return candidate.trim()
  return JSON.stringify(cloneProjectionValue(candidate))
}

const isGeneratedAcceptedCurrent = ({ accepted, generated }) => {
  if (!accepted || !generated) return false

  const acceptedGeneratedAt = normalizeKey(accepted.sourceGeneratedAt)
  const generatedAt = normalizeKey(generated.generatedAt)
  const acceptedInputHash = normalizeKey(accepted.inputHash)
  const generatedInputHash = normalizeKey(generated.inputHash)

  if (acceptedGeneratedAt && generatedAt && acceptedGeneratedAt !== generatedAt) return false
  if (acceptedInputHash && generatedInputHash && acceptedInputHash !== generatedInputHash) return false

  if (acceptedGeneratedAt && generatedAt && acceptedInputHash && generatedInputHash) return true

  return normalizeComparableSectionContent(accepted) === normalizeComparableSectionContent(generated)
}

const getScopedDiscoveryViewForSection = ({ discovery, runtimePath, sectionKey }) => {
  const scopedViews = discovery?.scopedViews && typeof discovery.scopedViews === 'object' && !Array.isArray(discovery.scopedViews)
    ? discovery.scopedViews
    : {}
  const runtimePathTail = String(runtimePath || '').split('.').filter(Boolean).pop()
  const candidates = [
    sectionKey,
    runtimePath,
    runtimePathTail,
    runtimePathTail?.replace(/_/g, '-'),
  ]
    .map(normalizeKey)
    .filter(Boolean)

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(scopedViews, candidate)) return scopedViews[candidate]
  }

  return null
}

const buildSectionCompareProjection = ({ accepted, generated, input, revisions }) => {
  const hasGenerated = hasProjectionValue(generated?.content ?? generated)
  const hasAccepted = hasProjectionValue(accepted?.content ?? accepted)
  const currentInputHash = hashSectionInput(input)
  const generatedInputHash = normalizeKey(generated?.inputHash)
  const generatedStaleAgainstInput = Boolean(hasGenerated && generatedInputHash && currentInputHash !== generatedInputHash)
  const currentGeneratedAccepted = !generatedStaleAgainstInput && isGeneratedAcceptedCurrent({ accepted, generated })
  const hasPreviousGeneratedRevision = Array.isArray(revisions) && revisions.some((revision) =>
    hasProjectionValue(revision?.generated?.content ?? revision?.generated),
  )
  let state = 'NO_GENERATED_CONTENT'
  let summary = 'No generated content is available for comparison.'

  if (generatedStaleAgainstInput) {
    state = 'GENERATED_STALE_AGAINST_INPUT'
    summary = 'Section input changed after generation. Regenerate before accepting or publishing truth.'
  } else if (hasGenerated && !hasAccepted) {
    state = 'UNACCEPTED_GENERATED_CONTENT'
    summary = 'Generated content is awaiting accepted truth review.'
  } else if (hasGenerated && currentGeneratedAccepted) {
    state = 'GENERATED_MATCHES_ACCEPTED_TRUTH'
    summary = 'Generated content matches the accepted truth metadata.'
  } else if (hasGenerated && hasAccepted) {
    state = 'GENERATED_DIFFERS_FROM_ACCEPTED_TRUTH'
    summary = 'Generated content differs from the accepted truth and should be reviewed before publish or lock.'
  } else if (!hasGenerated && hasAccepted) {
    state = 'ACCEPTED_TRUTH_WITHOUT_CURRENT_GENERATION'
    summary = 'Accepted truth exists without current generated content metadata.'
  }

  return {
    state,
    summary,
    currentGeneratedAccepted,
    generatedStaleAgainstInput,
    hasGenerated,
    hasAccepted,
    hasPreviousGeneratedRevision,
  }
}

const buildSectionDependencyProjection = ({
  accepted,
  dependencySectionKeys,
  generationEligibility,
  generated,
  sectionDependencies,
  sectionStates,
}) => {
  const requiredSectionKeys = Array.isArray(dependencySectionKeys) ? dependencySectionKeys : []
  const satisfiedSectionKeys = Array.isArray(generationEligibility?.satisfiedDependencySectionKeys)
    ? generationEligibility.satisfiedDependencySectionKeys
    : []
  const satisfiedSet = new Set(satisfiedSectionKeys)
  const missingSectionKeys = requiredSectionKeys.filter((sectionKey) => !satisfiedSet.has(sectionKey))
  const acceptedSectionKeys = []
  const missingAcceptedTruthSectionKeys = []
  const persistedInvalidatedSectionKeys = Array.isArray(sectionDependencies?.invalidatedSectionKeys)
    ? sectionDependencies.invalidatedSectionKeys.map(normalizeKey).filter(Boolean)
    : []
  const invalidatedSectionKeys = [...persistedInvalidatedSectionKeys]
  const dependencyInvalidationRecords = Array.isArray(sectionDependencies?.invalidations)
    ? sectionDependencies.invalidations.slice(-10)
    : []
  const downstreamGeneratedAt = parseRuntimeTimestamp(generated?.generatedAt)
  const downstreamAcceptedAt = parseRuntimeTimestamp(accepted?.acceptedAt)
  const downstreamSourceGeneratedAt = parseRuntimeTimestamp(accepted?.sourceGeneratedAt)
  const downstreamTruthTimestamp = downstreamGeneratedAt || downstreamSourceGeneratedAt || downstreamAcceptedAt

  requiredSectionKeys.forEach((sectionKey) => {
    const dependencyAccepted = getRuntimeSectionAccepted(sectionStates?.[sectionKey])
    if (!hasProjectionValue(dependencyAccepted?.content ?? dependencyAccepted)) {
      missingAcceptedTruthSectionKeys.push(sectionKey)
      return
    }

    acceptedSectionKeys.push(sectionKey)
    const dependencyAcceptedAt = parseRuntimeTimestamp(dependencyAccepted?.acceptedAt)
    if (
      dependencyAcceptedAt
      && downstreamTruthTimestamp
      && dependencyAcceptedAt > downstreamTruthTimestamp
      && !invalidatedSectionKeys.includes(sectionKey)
    ) {
      invalidatedSectionKeys.push(sectionKey)
    }
  })

  return {
    state: requiredSectionKeys.length === 0
      ? 'NO_SECTION_DEPENDENCIES'
      : missingSectionKeys.length > 0
        ? 'MISSING_CONTEXT'
        : missingAcceptedTruthSectionKeys.length > 0
          ? 'MISSING_ACCEPTED_TRUTH'
          : invalidatedSectionKeys.length > 0
            ? 'DEPENDENCY_CONTEXT_INVALIDATED'
            : 'SATISFIED',
    requiredSectionKeys,
    satisfiedSectionKeys,
    missingSectionKeys,
    acceptedSectionKeys,
    missingAcceptedTruthSectionKeys,
    invalidatedSectionKeys,
    dependencyInvalidationRecords,
    lastInvalidatedAt: sectionDependencies?.invalidatedAt || '',
    invalidatedBySectionKey: sectionDependencies?.invalidatedBySectionKey || '',
    invalidatedByRuntimePath: sectionDependencies?.invalidatedByRuntimePath || '',
  }
}

const buildSectionReadinessProjection = ({
  compare,
  dependency,
  sectionState,
  validationMessages,
}) => {
  const blockingValidationCount = validationMessages
    .filter((message) => normalizeToken(message?.severity) === 'ERROR')
    .length

  if (blockingValidationCount > 0) {
    return {
      state: 'VALIDATION_BLOCKED',
      publishEligible: false,
      reason: 'Section has blocking validation messages.',
      blockingValidationCount,
    }
  }

  if (dependency.state === 'MISSING_CONTEXT') {
    return {
      state: 'DEPENDENCY_CONTEXT_MISSING',
      publishEligible: false,
      reason: 'Required upstream section context is missing.',
      blockingValidationCount,
    }
  }

  if (dependency.state === 'MISSING_ACCEPTED_TRUTH') {
    return {
      state: 'DEPENDENCY_ACCEPTED_TRUTH_MISSING',
      publishEligible: false,
      reason: 'Required upstream accepted truth is missing.',
      blockingValidationCount,
    }
  }

  if (dependency.state === 'DEPENDENCY_CONTEXT_INVALIDATED') {
    return {
      state: 'REGENERATION_REQUIRED',
      publishEligible: false,
      reason: 'Accepted upstream section truth changed. Regenerate this section before publish or lock.',
      blockingValidationCount,
    }
  }

  if (sectionState?.needsRegeneration === true) {
    return {
      state: 'REGENERATION_REQUIRED',
      publishEligible: false,
      reason: sectionState?.acceptedInvalidationReason === 'SECTION_EVIDENCE_CHANGED'
        || sectionState?.sectionEvidenceInvalidationReason === 'SECTION_EVIDENCE_CHANGED'
        ? 'Accepted section evidence changed. Regenerate this section before accepting or publishing truth.'
        : 'Section evidence changed. Regenerate this section before accepting or publishing truth.',
      blockingValidationCount,
    }
  }

  if (compare.currentGeneratedAccepted) {
    return {
      state: 'ACCEPTED_TRUTH_READY',
      publishEligible: true,
      reason: '',
      blockingValidationCount,
    }
  }

  if (compare.generatedStaleAgainstInput) {
    return {
      state: 'REGENERATION_REQUIRED',
      publishEligible: false,
      reason: 'Section input changed after generation. Regenerate before accepting or publishing truth.',
      blockingValidationCount,
    }
  }

  if (compare.hasAccepted) {
    return {
      state: 'ACCEPTED_TRUTH_REVIEW_NEEDED',
      publishEligible: false,
      reason: 'Accepted truth is not aligned with current generated content.',
      blockingValidationCount,
    }
  }

  if (compare.hasGenerated) {
    return {
      state: 'GENERATED_REVIEW_NEEDED',
      publishEligible: false,
      reason: 'Generated content must be accepted as governed truth.',
      blockingValidationCount,
    }
  }

  return {
    state: 'DRAFT_INPUT_NEEDED',
    publishEligible: false,
    reason: 'Section needs generated and accepted truth before publish or lock.',
    blockingValidationCount,
  }
}

const buildSectionConfidenceProjection = ({
  compare,
  dependency,
  discoveryScopedView,
  generationEligibility,
  readiness,
}) => {
  const reasons = []
  let score = 0

  if (hasProjectionValue(discoveryScopedView)) {
    score += 20
    reasons.push('DISCOVERY_SCOPED_EVIDENCE')
  }
  if (generationEligibility?.sources?.includes('SECTION_CONTEXT')) {
    score += 15
    reasons.push('ADDITIONAL_CONTEXT')
  }
  if (compare.hasGenerated) {
    score += 20
    reasons.push('GENERATED_CONTENT')
  }
  if (compare.generatedStaleAgainstInput) {
    score = Math.max(0, score - 25)
    reasons.push('GENERATED_STALE_AGAINST_INPUT')
  }
  if (compare.currentGeneratedAccepted) {
    score += 35
    reasons.push('ACCEPTED_TRUTH_CURRENT')
  } else if (compare.hasAccepted) {
    score += 20
    reasons.push('ACCEPTED_TRUTH_PRESENT')
  }
  if (dependency.state === 'MISSING_CONTEXT') {
    score = Math.max(0, score - 15)
    reasons.push('DEPENDENCY_CONTEXT_MISSING')
  }
  if (dependency.state === 'MISSING_ACCEPTED_TRUTH') {
    score = Math.max(0, score - 20)
    reasons.push('DEPENDENCY_ACCEPTED_TRUTH_MISSING')
  }
  if (dependency.state === 'DEPENDENCY_CONTEXT_INVALIDATED') {
    score = Math.max(0, score - 25)
    reasons.push('DEPENDENCY_CONTEXT_INVALIDATED')
  }
  if (readiness.blockingValidationCount > 0) {
    score = Math.max(0, score - 20)
    reasons.push('VALIDATION_BLOCKED')
  }

  return {
    level: score >= 80 ? 'HIGH' : score >= 50 ? 'MEDIUM' : score > 0 ? 'LOW' : 'NONE',
    score,
    reasons,
  }
}

const buildSectionIntelligenceProjection = ({
  accepted,
  discovery,
  enrichment,
  generationEligibility,
  generated,
  input,
  sectionDependencies,
  dependencySectionKeys,
  revisions,
  runtimePath,
  sectionKey,
  sectionStates,
  sectionState,
  validationMessages,
}) => {
  const discoveryScopedView = getScopedDiscoveryViewForSection({ discovery, runtimePath, sectionKey })
  const compare = buildSectionCompareProjection({ accepted, generated, input, revisions })
  const dependency = buildSectionDependencyProjection({
    accepted,
    dependencySectionKeys,
    generationEligibility,
    generated,
    sectionDependencies,
    sectionStates,
  })
  const readiness = buildSectionReadinessProjection({
    compare,
    dependency,
    sectionState,
    validationMessages,
  })
  const confidence = buildSectionConfidenceProjection({
    compare,
    dependency,
    discoveryScopedView,
    generationEligibility,
    readiness,
  })
  const safeEnrichment = isProjectionObject(enrichment) ? enrichment : {}
  const mergedDisplayProjection = {
    ...(isProjectionObject(safeEnrichment.displayProjection) ? safeEnrichment.displayProjection : {}),
  }

  return {
    ...safeEnrichment,
    ownershipZones: {
      suggestedFromDiscovery: {
        available: hasProjectionValue(discoveryScopedView),
        source: hasProjectionValue(discoveryScopedView) ? 'DISCOVERY_EVIDENCE_PACK' : '',
      },
      additionalContext: {
        available: hasProjectionValue(input),
      },
      generatedSection: {
        available: compare.hasGenerated,
        generatedAt: generated?.generatedAt || '',
        generatorMode: generated?.generator?.mode || '',
      },
      acceptedTruth: {
        available: compare.hasAccepted,
        current: compare.currentGeneratedAccepted,
        acceptedAt: accepted?.acceptedAt || '',
      },
    },
    confidence,
    dependency,
    compare,
    readiness,
    ...(Object.keys(mergedDisplayProjection).length > 0 ? { displayProjection: mergedDisplayProjection } : {}),
    metrics: {
      revisionCount: Array.isArray(revisions) ? revisions.length : 0,
      validationMessageCount: validationMessages.length,
    },
    generationControls: {
      tokenProfile: 'SECTION_SCOPED_BOUNDED',
      fullVmfSynthesisAllowed: false,
      runtimeOutputExpansionAllowed: false,
    },
  }
}

const resolveControlType = (runtimePathRecord) => {
  const explicitControl = normalizeToken(runtimePathRecord?.uiControl)
  if (explicitControl) return explicitControl

  const dataType = normalizeToken(runtimePathRecord?.dataType)
  if (dataType === 'NUMBER') return RUNTIME_PATH_REGISTRY_UI_CONTROLS.NUMBER
  if (dataType === 'BOOLEAN') return RUNTIME_PATH_REGISTRY_UI_CONTROLS.CHECKBOX
  if (dataType === 'ENUM') return RUNTIME_PATH_REGISTRY_UI_CONTROLS.SELECT
  if (dataType === 'OBJECT' || dataType === 'ARRAY') return RUNTIME_PATH_REGISTRY_UI_CONTROLS.JSON
  return RUNTIME_PATH_REGISTRY_UI_CONTROLS.TEXT
}

const isRuntimeEditable = (runtimeInstance) => {
  const runtimeStatus = normalizeToken(runtimeInstance?.status)
  const executionStatus = normalizeToken(runtimeInstance?.executionStatus)
  const frameworkState = normalizeFrameworkStateForAction(runtimeInstance?.framework_state)

  if (isRuntimeLocked({ runtimeInstance })) return false
  if (isRuntimeLifecycleTruthImmutable(frameworkState)) return false
  if (runtimeStatus !== RUNTIME_INSTANCE_STATUSES.ACTIVE) return false

  return ![
    RUNTIME_EXECUTION_STATUSES.RUNNING,
    RUNTIME_EXECUTION_STATUSES.VALIDATING,
    RUNTIME_EXECUTION_STATUSES.COMPLETE,
    RUNTIME_EXECUTION_STATUSES.ERROR,
  ].includes(executionStatus)
}

const isRuntimeLockedForInspection = ({ runtimeInstance, frameworkState } = {}) =>
  isRuntimeLocked({
    runtimeInstance,
    frameworkState: frameworkState || runtimeInstance?.framework_state,
  })

const resolveSectionMutationAccess = async ({ runtimeInstance, scopes }) => {
  const runtimeType = normalizeToken(runtimeInstance?.runtimeType)
  const requiredPermissions = ['VMF_UPDATE']

  if (runtimeType !== RUNTIME_TYPES.VALUE_NARRATIVE) {
    return {
      allowed: false,
      requiredPermissions,
      reason: 'Runtime section mutation is only available for Value Narrative runtimes in Sprint 1.',
    }
  }

  try {
    await assertRuntimePermission({
      scopes,
      customerId: toIdString(runtimeInstance?.customerId),
      tenantId: toIdString(runtimeInstance?.tenantId),
      permission: 'VMF_UPDATE',
    })
    return {
      allowed: true,
      requiredPermissions,
      reason: '',
    }
  } catch {
    return {
      allowed: false,
      requiredPermissions,
      reason: 'Current role or permissions do not allow runtime section mutation.',
    }
  }
}

const getReadonlyReason = ({
  editable,
  mutationAccess,
  pathWritable,
  runtimeLocked = false,
  runtimeEditable,
  uiEditable,
}) => {
  if (editable) return ''
  if (!runtimeEditable && runtimeLocked) return LOCKED_RUNTIME_READONLY_REASON
  if (!runtimeEditable) return 'Renderer editability is governed by runtime lifecycle, status, and execution status.'
  if (!uiEditable) return 'Renderer editability is governed by the UI Contract.'
  if (!pathWritable) return 'Renderer editability is governed by runtime path operations.'
  if (mutationAccess?.allowed === false) return mutationAccess.reason
  return 'Renderer editability is governed by runtime status, execution status, UI Contract, runtime path operations, and mutation permissions.'
}

const buildSectionStateProjection = ({ sectionRevisions, sectionState, runtimeLocked }) => {
  const projectedState = {
    status: sectionState.status || 'DRAFT',
    revisionCount: sectionRevisions.length,
    ...sectionState,
  }

  if (!runtimeLocked) return projectedState

  return {
    ...projectedState,
    sourceStatus: projectedState.status || 'DRAFT',
    status: 'LOCKED',
    locked: true,
    readonlyReason: LOCKED_RUNTIME_READONLY_REASON,
  }
}

const buildSectionValidationMessages = ({ frameworkState, validationKeys }) => {
  const validationState = frameworkState?.validation || {}
  if (!Array.isArray(validationKeys) || validationKeys.length === 0) return []

  return validationKeys.flatMap((validationKey) => {
    const normalizedKey = String(validationKey || '').trim()
    const underscoreKey = normalizedKey.replace(/-/g, '_')
    const result = validationState[normalizedKey] || validationState[underscoreKey]

    if (!result || typeof result !== 'object' || Array.isArray(result)) return []

    const messages = []
    if (result.message) {
      messages.push({
        validationKey: normalizedKey,
        severity: result.is_valid === false ? 'ERROR' : 'INFO',
        message: String(result.message),
      })
    }

    if (Array.isArray(result.messages)) {
      result.messages.forEach((message) => {
        if (!message) return
        if (typeof message === 'string') {
          messages.push({
            validationKey: normalizedKey,
            severity: result.is_valid === false ? 'ERROR' : 'INFO',
            message,
          })
          return
        }

        messages.push({
          validationKey: normalizedKey,
          severity: normalizeToken(message.severity || (result.is_valid === false ? 'ERROR' : 'INFO')),
          message: String(message.message || ''),
        })
      })
    }

    return messages.filter((message) => message.message)
  })
}

const deriveValidationState = (frameworkState) => {
  const validationState = frameworkState?.validation || {}
  const rows = Object.values(validationState).filter(
    (value) => value && typeof value === 'object' && !Array.isArray(value),
  )

  if (rows.some((row) => row.blocking === true && row.is_valid === false)) return 'BLOCKED'
  if (rows.some((row) => row.is_valid === false)) return 'FAILED'
  if (rows.some((row) => row.is_valid === true)) return 'PASSED'
  return 'UNKNOWN'
}

const evaluateCondition = (condition, runtimeContext) => {
  const path = String(condition?.path || '').trim()
  const operator = String(condition?.operator || '').trim()
  const expected = condition?.value
  const current = getValueAtPath(runtimeContext, path)
  const exists = current !== VALUE_NOT_FOUND && current !== undefined && current !== null

  switch (operator) {
    case WORKFLOW_POLICY_CONDITION_OPERATORS.EXISTS:
      return exists
    case WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_EXISTS:
      return !exists
    case WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_EQUALS:
      return current !== expected
    case WORKFLOW_POLICY_CONDITION_OPERATORS.CONTAINS:
      if (!exists) return false
      if (Array.isArray(current)) return current.includes(expected)
      return String(current).includes(String(expected))
    case WORKFLOW_POLICY_CONDITION_OPERATORS.IN:
      return Array.isArray(expected) && expected.includes(current)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.NOT_IN:
      return Array.isArray(expected) && !expected.includes(current)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.GREATER_THAN:
      return Number(current) > Number(expected)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.LESS_THAN:
      return Number(current) < Number(expected)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.GREATER_THAN_OR_EQUAL:
      return Number(current) >= Number(expected)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.LESS_THAN_OR_EQUAL:
      return Number(current) <= Number(expected)
    case WORKFLOW_POLICY_CONDITION_OPERATORS.EQUALS:
    default:
      return current === expected
  }
}

const evaluatePolicyConditions = ({ policy, runtimeContext }) => {
  const conditions = Array.isArray(policy?.conditions) ? policy.conditions : []
  if (conditions.length === 0) return true

  let aggregate = evaluateCondition(conditions[0], runtimeContext)

  for (let index = 1; index < conditions.length; index += 1) {
    const previousLogic = normalizeToken(conditions[index - 1]?.logic || WORKFLOW_POLICY_CONDITION_LOGIC.AND)
    const currentResult = evaluateCondition(conditions[index], runtimeContext)
    aggregate = previousLogic === WORKFLOW_POLICY_CONDITION_LOGIC.OR
      ? aggregate || currentResult
      : aggregate && currentResult
  }

  return aggregate
}

const buildRuntimeContext = (runtimeInstance) => ({
  framework_state: runtimeInstance.framework_state || {},
  runtimeInstance,
  runtime: {
    id: runtimeInstance.id,
    runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
    runtimeType: runtimeInstance.runtimeType,
    status: runtimeInstance.status,
    executionStatus: runtimeInstance.executionStatus,
    lockedAt: runtimeInstance.lockedAt || null,
    lockedBy: runtimeInstance.lockedBy || null,
    lockedReason: runtimeInstance.lockedReason || '',
    runtimeMode: runtimeInstance.runtimeMode,
    workspaceId: runtimeInstance.workspaceId,
    customerId: runtimeInstance.customerId,
    tenantId: runtimeInstance.tenantId,
  },
})

const getResolvedPermissionsSnapshot = (scopes = {}) => ({
  platform: scopes?.resolvedPermissions?.platform || { roleKeys: [], permissions: [] },
  customers: Array.isArray(scopes?.resolvedPermissions?.customers)
    ? scopes.resolvedPermissions.customers
    : [],
  tenants: Array.isArray(scopes?.resolvedPermissions?.tenants)
    ? scopes.resolvedPermissions.tenants
    : [],
})

const getCustomerBucket = (scopes, customerId) =>
  getResolvedPermissionsSnapshot(scopes).customers.find(
    (bucket) => toIdString(bucket?.customerId) === String(customerId),
  ) || null

const getTenantBucket = (scopes, customerId, tenantId) =>
  getResolvedPermissionsSnapshot(scopes).tenants.find(
    (bucket) =>
      toIdString(bucket?.customerId) === String(customerId)
      && toIdString(bucket?.tenantId) === String(tenantId),
  ) || null

const getRuntimeRoleKeys = ({ scopes, runtimeInstance }) => {
  const resolved = getResolvedPermissionsSnapshot(scopes)
  const customerBucket = getCustomerBucket(scopes, runtimeInstance.customerId)
  const tenantBucket = getTenantBucket(scopes, runtimeInstance.customerId, runtimeInstance.tenantId)

  return uniqueTokens([
    ...(resolved.platform.roleKeys || []),
    ...(customerBucket?.roleKeys || []),
    ...(tenantBucket?.roleKeys || []),
  ])
}

const getRuntimeEvidence = (runtimeInstance) => ({
  activationId: String(runtimeInstance.evidence?.activationId || runtimeInstance.activationId || '').trim(),
  deploymentId: String(runtimeInstance.evidence?.deploymentId || runtimeInstance.deploymentId || '').trim(),
  dependencySnapshotId: String(runtimeInstance.evidence?.dependencySnapshotId || runtimeInstance.dependencyLockId || '').trim(),
  dependencySnapshotHash: String(runtimeInstance.evidence?.dependencySnapshotHash || '').trim(),
})

const createSnapshotMismatchError = ({ runtimeInstance, message, details = {} }) =>
  createRuntimeRendererError({
    status: 409,
    code: 'CONFLICT',
    message,
    reason: RUNTIME_RENDERER_ERROR_REASONS.DEPLOYMENT_SNAPSHOT_MISMATCH,
    details: {
      runtimeInstanceId: runtimeInstance.id,
      packageId: runtimeInstance.packageId,
      ...details,
    },
  })

const assertDeploymentSnapshotEvidence = async ({ runtimeInstance, frameworkPackage }) => {
  const evidence = getRuntimeEvidence(runtimeInstance)
  const missingEvidence = Object.entries(evidence)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missingEvidence.length > 0) {
    throw createSnapshotMismatchError({
      runtimeInstance,
      message: 'Runtime renderer requires immutable deployment and snapshot evidence.',
      details: { missingEvidence },
    })
  }

  const [deployment, activationSnapshot] = await Promise.all([
    RuntimeDeployment.findOne({
      deploymentId: evidence.deploymentId,
      activationId: evidence.activationId,
      packageId: runtimeInstance.packageId,
      frameworkKey: runtimeInstance.frameworkKey,
    }).lean(),
    RuntimeActivationSnapshot.findOne({
      activationId: evidence.activationId,
      deploymentId: evidence.deploymentId,
      packageId: runtimeInstance.packageId,
    }).lean(),
  ])

  if (!deployment || !activationSnapshot) {
    throw createSnapshotMismatchError({
      runtimeInstance,
      message: 'Runtime renderer could not resolve immutable deployment snapshot evidence.',
      details: {
        deploymentId: evidence.deploymentId,
        activationId: evidence.activationId,
        deploymentFound: Boolean(deployment),
        activationSnapshotFound: Boolean(activationSnapshot),
      },
    })
  }

  const mismatches = []
  if (toIdString(deployment.packageId) !== toIdString(runtimeInstance.packageId)) mismatches.push('deployment.packageId')
  if (toIdString(activationSnapshot.packageId) !== toIdString(runtimeInstance.packageId)) mismatches.push('activationSnapshot.packageId')
  if (normalizeToken(deployment.frameworkKey) !== normalizeToken(runtimeInstance.frameworkKey)) mismatches.push('deployment.frameworkKey')
  if (normalizeToken(activationSnapshot.frameworkKey) !== normalizeToken(runtimeInstance.frameworkKey)) mismatches.push('activationSnapshot.frameworkKey')
  if (!RENDERABLE_DEPLOYMENT_STATUSES.has(normalizeToken(deployment.status))) mismatches.push('deployment.status')
  if (!RENDERABLE_ACTIVATION_STATUSES.has(normalizeToken(activationSnapshot.activationStatus))) mismatches.push('activationSnapshot.activationStatus')
  if (String(deployment.packageKey || '') !== String(runtimeInstance.packageKey || '')) mismatches.push('deployment.packageKey')
  if (String(activationSnapshot.packageKey || '') !== String(runtimeInstance.packageKey || '')) mismatches.push('activationSnapshot.packageKey')
  if (String(deployment.frameworkVersion || '') !== String(runtimeInstance.packageVersion || frameworkPackage.version || '')) mismatches.push('deployment.frameworkVersion')
  if (String(activationSnapshot.frameworkVersion || '') !== String(runtimeInstance.packageVersion || frameworkPackage.version || '')) mismatches.push('activationSnapshot.frameworkVersion')
  if (String(activationSnapshot.dependencySnapshotId || '').trim() !== evidence.dependencySnapshotId) mismatches.push('activationSnapshot.dependencySnapshotId')
  if (String(activationSnapshot.dependencySnapshotHash || '').trim() !== evidence.dependencySnapshotHash) mismatches.push('activationSnapshot.dependencySnapshotHash')

  if (mismatches.length > 0) {
    throw createSnapshotMismatchError({
      runtimeInstance,
      message: 'Runtime renderer snapshot evidence does not match immutable activation evidence.',
      details: {
        deploymentId: evidence.deploymentId,
        activationId: evidence.activationId,
        dependencySnapshotId: evidence.dependencySnapshotId,
        mismatches,
      },
    })
  }
}

const resolvePackage = async ({ runtimeInstance }) => {
  const frameworkPackage = toPlainObject(await FrameworkPackage.findById(runtimeInstance.packageId))

  if (!frameworkPackage) {
    throw createRuntimeRendererError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Framework package not found for runtime renderer.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.PACKAGE_NOT_FOUND,
      details: {
        runtimeInstanceId: runtimeInstance.id,
        packageId: runtimeInstance.packageId,
      },
    })
  }

  if (normalizeToken(frameworkPackage.frameworkKey) !== normalizeToken(runtimeInstance.frameworkKey)) {
    throw createRuntimeRendererError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Framework package does not match the runtime instance framework.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.PACKAGE_FRAMEWORK_MISMATCH,
      details: {
        runtimeInstanceId: runtimeInstance.id,
        packageId: runtimeInstance.packageId,
        runtimeFrameworkKey: runtimeInstance.frameworkKey,
        packageFrameworkKey: frameworkPackage.frameworkKey,
      },
    })
  }

  if (frameworkPackage.status !== FRAMEWORK_PACKAGE_STATUSES.ACTIVE) {
    throw createRuntimeRendererError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime renderer requires an ACTIVE framework package.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.PACKAGE_NOT_ACTIVE,
      details: {
        runtimeInstanceId: runtimeInstance.id,
        packageId: runtimeInstance.packageId,
        packageStatus: frameworkPackage.status,
      },
    })
  }

  await assertDeploymentSnapshotEvidence({ runtimeInstance, frameworkPackage })

  return frameworkPackage
}

const resolveUIContract = async ({ frameworkPackage }) => {
  const packageSections = Array.isArray(frameworkPackage.sections) ? frameworkPackage.sections : []
  const uiContractKey = normalizeKey(frameworkPackage.uiContractBinding?.key || frameworkPackage.uiContractKey)

  if (packageSections.length > 0 && !uiContractKey) {
    throw createRuntimeRendererError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime renderer requires a UI Contract for packages with sections.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.UI_CONTRACT_REQUIRED,
      details: {
        packageId: toIdString(frameworkPackage._id || frameworkPackage.id),
        packageKey: frameworkPackage.packageKey,
      },
    })
  }

  if (!uiContractKey) return null

  const uiContract = await UIContract.findOne({
    uiContractKey,
    status: UI_CONTRACT_STATUSES.ACTIVE,
    frameworkKeys: normalizeToken(frameworkPackage.frameworkKey),
  }).lean()

  if (!uiContract) {
    throw createRuntimeRendererError({
      status: 409,
      code: 'CONFLICT',
      message: 'Active UI Contract could not be resolved for runtime renderer.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.UI_CONTRACT_NOT_FOUND,
      details: {
        packageId: toIdString(frameworkPackage._id || frameworkPackage.id),
        packageKey: frameworkPackage.packageKey,
        uiContractKey,
      },
    })
  }

  return uiContract
}

const resolveRuntimePathRecords = async ({ frameworkPackage }) => {
  const runtimePaths = (Array.isArray(frameworkPackage.sections) ? frameworkPackage.sections : [])
    .map((section) => String(section?.runtimePath || '').trim())
    .filter(Boolean)

  if (runtimePaths.length === 0) return new Map()

  const rows = await RuntimePathRegistry.find({
    pathKey: { $in: [...new Set(runtimePaths)] },
    status: RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE,
    frameworkKeys: normalizeToken(frameworkPackage.frameworkKey || VMF_FRAMEWORK_KEY),
  }).lean()

  return new Map(
    (Array.isArray(rows) ? rows : [])
      .map((row) => [String(row?.pathKey || '').trim(), row]),
  )
}

const buildSectionIndex = (uiContract) => {
  const sections = Array.isArray(uiContract?.sections) ? uiContract.sections : []
  const byExactKey = new Map()
  const packageSectionKeys = new Set()

  sections.forEach((section) => {
    const sectionKey = normalizeKey(section?.sectionKey)
    const runtimePath = String(section?.runtimePath || '').trim()
    if (!sectionKey) return
    if (!section.isCustom) packageSectionKeys.add(sectionKey)
    if (runtimePath) byExactKey.set(`${sectionKey}::${runtimePath}`, section)
  })

  return { byExactKey, packageSectionKeys, sections }
}

const buildRendererSections = ({
  discovery,
  frameworkPackage,
  mutationAccess,
  runtimeInstance,
  runtimePathRecords,
  uiContract,
  configWarnings,
}) => {
  const packageSections = Array.isArray(frameworkPackage.sections) ? frameworkPackage.sections : []
  const { byExactKey, sections: uiSections } = buildSectionIndex(uiContract)
  const packageSectionKeys = new Set()
  const frameworkState = runtimeInstance.framework_state || {}
  const runtimeEditable = isRuntimeEditable(runtimeInstance)
  const runtimeLocked = isRuntimeLockedForInspection({ runtimeInstance, frameworkState })
  const renderedSections = []

  packageSections.forEach((packageSection, packageIndex) => {
    const sectionKey = normalizeKey(packageSection?.sectionKey)
    const runtimePath = String(packageSection?.runtimePath || '').trim()
    if (sectionKey) packageSectionKeys.add(sectionKey)

    if (!sectionKey) return

    if (!runtimePath) {
      configWarnings.push(createConfigWarning({
        code: CONFIG_WARNING_CODES.PACKAGE_SECTION_MISSING_RUNTIME_PATH,
        message: 'Package section is missing a runtime path and cannot be rendered.',
        sectionKey,
      }))
      return
    }

    const runtimePathRecord = runtimePathRecords.get(runtimePath)
    if (!runtimePathRecord) {
      configWarnings.push(createConfigWarning({
        code: CONFIG_WARNING_CODES.RUNTIME_PATH_NOT_FOUND,
        message: 'Package section runtime path is not registered and cannot be rendered.',
        sectionKey,
        runtimePath,
      }))
      return
    }

    const allowedOperations = Array.isArray(runtimePathRecord.allowedOperations)
      ? runtimePathRecord.allowedOperations.map(normalizeToken)
      : []

    if (!allowedOperations.includes(RUNTIME_PATH_REGISTRY_OPERATIONS.READ)) {
      configWarnings.push(createConfigWarning({
        code: CONFIG_WARNING_CODES.RUNTIME_PATH_NOT_READABLE,
        message: 'Package section runtime path does not allow READ and cannot be rendered.',
        sectionKey,
        runtimePath,
      }))
      return
    }

    const uiSection = byExactKey.get(`${sectionKey}::${runtimePath}`) || null
    if (!uiSection) {
      configWarnings.push(createConfigWarning({
        code: CONFIG_WARNING_CODES.UI_CONTRACT_SECTION_MISSING,
        message: 'Runtime path is missing a UI Contract section; fallback presentation was applied.',
        sectionKey,
        runtimePath,
      }))
    }

    const uiVisible = uiSection?.isVisible !== false
    const uiEditable = uiSection?.isEditable !== false && uiSection?.isReadOnlyDisplay !== true
    const pathWritable = allowedOperations.includes(RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE)
    const editable = Boolean(runtimeEditable && uiEditable && pathWritable && mutationAccess?.allowed)
    const validationKeys = Array.isArray(packageSection.validationKeys)
      ? packageSection.validationKeys.map((key) => String(key || '').trim()).filter(Boolean)
      : []

    const rawSectionValue = getRuntimePathValue(frameworkState, runtimePath)
    const sectionGenerated = getRuntimeSectionGenerated(rawSectionValue)
    const sectionAccepted = getRuntimeSectionAccepted(rawSectionValue)
    const sectionAcceptedRevisions = Array.isArray(sectionAccepted?.revisions) ? sectionAccepted.revisions : []
    const sectionDependencies = getRuntimeSectionDependencies(rawSectionValue)
    const sectionRevisions = getRuntimeSectionRevisions(rawSectionValue)
    const sectionState = getRuntimeSectionState(rawSectionValue)
    const sectionEvidence = buildSectionEvidenceProjection(rawSectionValue)
    const dependencySectionKeys = getDependencySectionKeys(packageSection)
    const generationEligibility = buildSectionGenerationEligibility({
      dependencySectionKeys,
      discovery,
      frameworkState,
      rawSectionValue,
    })
    const sectionInput = getRuntimeSectionInput(rawSectionValue)
    const validationMessages = buildSectionValidationMessages({ frameworkState, validationKeys })
    const persistedIntelligence = isRuntimeSectionObject(rawSectionValue) && isProjectionObject(rawSectionValue.intelligence)
      ? rawSectionValue.intelligence
      : {}
    const projectedEnrichment = buildSectionIntelligenceDisplayProjection({
      dependencySectionKeys,
      frameworkPackage,
      frameworkState,
      generated: sectionGenerated,
      generatedAt: sectionGenerated?.generatedAt || (
        runtimeInstance.updatedAt instanceof Date
          ? runtimeInstance.updatedAt.toISOString()
          : runtimeInstance.updatedAt
      ) || new Date().toISOString(),
      input: sectionInput,
      runtimeInstance,
      section: packageSection,
    })
    const sectionEnrichment = {
      ...projectedEnrichment,
      ...persistedIntelligence,
      displayProjection: {
        ...(isProjectionObject(projectedEnrichment.displayProjection) ? projectedEnrichment.displayProjection : {}),
        ...(isProjectionObject(persistedIntelligence.displayProjection) ? persistedIntelligence.displayProjection : {}),
      },
    }
    const safeSectionEnrichment = mutationAccess?.allowed === true
      ? sectionEnrichment
      : redactReadOnlySectionIntelligence(sectionEnrichment)
    const sectionIntelligence = buildSectionIntelligenceProjection({
      accepted: sectionAccepted,
      discovery,
      enrichment: safeSectionEnrichment,
      generationEligibility,
      generated: sectionGenerated,
      input: sectionInput,
      sectionDependencies,
      dependencySectionKeys,
      revisions: sectionRevisions,
      runtimePath,
      sectionKey,
      sectionStates: frameworkState.sections || {},
      sectionState,
      validationMessages,
    })

    renderedSections.push({
      key: sectionKey,
      sectionKey,
      runtimePath,
      label: uiSection?.label || runtimePathRecord.label || titleFromKey(sectionKey),
      shortLabel: uiSection?.shortLabel || '',
      control: resolveControlType(runtimePathRecord),
      dataType: normalizeToken(runtimePathRecord.dataType),
      allowedValues: Array.isArray(runtimePathRecord.allowedValues) ? runtimePathRecord.allowedValues : [],
      allowedValueLabels: runtimePathRecord.allowedValueLabels || {},
      required: Boolean(packageSection.required),
      helpText: uiSection?.helpText || runtimePathRecord.helpText || '',
      placeholder: uiSection?.placeholder || runtimePathRecord.placeholderText || '',
      value: sectionInput ?? runtimePathRecord.defaultValue ?? '',
      generated: sectionGenerated,
      accepted: sectionAccepted,
      sectionEvidence,
      review: isRuntimeSectionObject(rawSectionValue) ? rawSectionValue.review || {} : {},
      state: buildSectionStateProjection({ sectionRevisions, sectionState, runtimeLocked }),
      lineage: isRuntimeSectionObject(rawSectionValue) ? rawSectionValue.lineage || {} : {},
      dependencies: sectionDependencies,
      revisions: sectionRevisions.map((revision) => ({
        revisionNumber: revision.revisionNumber,
        replacedAt: revision.replacedAt,
        generated: revision.generated || null,
        accepted: revision.accepted || null,
      })),
      acceptedRevisions: sectionAcceptedRevisions.map((revision) => ({
        revisionNumber: revision.revisionNumber,
        replacedAt: revision.replacedAt,
        reason: revision.reason || '',
        accepted: revision.accepted || null,
      })),
      generationEligibility,
      intelligence: sectionIntelligence,
      confidence: sectionIntelligence.confidence,
      dependency: sectionIntelligence.dependency,
      compare: sectionIntelligence.compare,
      readiness: sectionIntelligence.readiness,
      validationKeys,
      validationMessages,
      editable,
      visible: uiVisible,
      readonlyReason: getReadonlyReason({
        editable,
        mutationAccess,
        pathWritable,
        runtimeLocked,
        runtimeEditable,
        uiEditable,
      }),
      allowedOperations,
      requiredPermissions: mutationAccess?.requiredPermissions || [],
      source: {
        package: true,
        runtimePath: true,
        uiContract: Boolean(uiSection),
      },
      displayOrder: Number.isFinite(Number(uiSection?.displayOrder))
        ? Number(uiSection.displayOrder)
        : Number.isFinite(Number(runtimePathRecord.displayOrder))
          ? Number(runtimePathRecord.displayOrder)
          : (packageIndex + 1) * 10,
      sectionGroup: uiSection?.sectionGroup || '',
      presentationKey: uiSection?.presentationKey || '',
      collapsedByDefault: Boolean(uiSection?.isCollapsedByDefault),
    })
  })

  uiSections.forEach((uiSection) => {
    const sectionKey = normalizeKey(uiSection?.sectionKey)
    if (!sectionKey || uiSection?.isCustom === true) return
    if (packageSectionKeys.has(sectionKey)) return

    configWarnings.push(createConfigWarning({
      code: CONFIG_WARNING_CODES.UI_CONTRACT_SECTION_ORPHANED,
      message: 'UI Contract section is not present in the package and was ignored.',
      sectionKey,
      runtimePath: uiSection.runtimePath,
    }))
  })

  return renderedSections
    .filter((section) => section.visible)
    .sort((left, right) => left.displayOrder - right.displayOrder || left.sectionKey.localeCompare(right.sectionKey))
}

const resolveWorkflowPolicies = async ({ frameworkPackage }) => {
  const workflowBindings = Array.isArray(frameworkPackage.workflowBindings)
    ? frameworkPackage.workflowBindings.filter((binding) => binding?.enabled !== false)
    : []
  const policyKeys = [...new Set(
    workflowBindings
      .map((binding) => normalizeKey(binding?.policyKey))
      .filter(Boolean),
  )]

  if (policyKeys.length === 0) {
    return { policies: [], bindingByPolicyKey: new Map() }
  }

  const rows = await WorkflowPolicy.find({
    key: { $in: policyKeys },
    status: WORKFLOW_POLICY_STATUSES.ACTIVE,
    frameworkKeys: normalizeToken(frameworkPackage.frameworkKey || VMF_FRAMEWORK_KEY),
  }).lean()

  const bindingByPolicyKey = new Map(
    workflowBindings.map((binding) => [normalizeKey(binding?.policyKey), binding]),
  )

  return {
    policies: Array.isArray(rows) ? rows : [],
    bindingByPolicyKey,
  }
}

const EXECUTABLE_WORKFLOW_POLICY_DECISION_MODES = new Set([
  WORKFLOW_POLICY_DECISION_MODES.ALLOW,
  WORKFLOW_POLICY_DECISION_MODES.REQUIRE_AGENT_AND_SKILL_EXECUTION,
])

const isExecutablePolicyDecision = (decisionMode) =>
  EXECUTABLE_WORKFLOW_POLICY_DECISION_MODES.has(normalizeToken(decisionMode))

const getDefaultRuntimeActionPermission = ({ runtimeInstance, governedAction }) => {
  const runtimeType = normalizeToken(runtimeInstance?.runtimeType)
  const actionToken = normalizeToken(governedAction)
  const isMutatingAction = MUTATING_RUNTIME_ACTIONS.has(actionToken)

  if (runtimeType === RUNTIME_TYPES.DEAL_ANALYSIS) {
    return isMutatingAction ? 'DEAL_UPDATE' : 'DEAL_VIEW'
  }

  return isMutatingAction ? 'VMF_UPDATE' : 'VMF_VIEW'
}

const getActionAccess = async ({ action, runtimeInstance, scopes, governedAction }) => {
  const requiredPermissions = uniqueTokens(
    action?.requiredPermissions
    || action?.permissions
    || [getDefaultRuntimeActionPermission({ runtimeInstance, governedAction })],
  )
  const rolesAllowed = uniqueTokens(action?.rolesAllowed)
  const actorRoleKeys = getRuntimeRoleKeys({ scopes, runtimeInstance })
  const hasAllowedRole = rolesAllowed.length === 0
    || rolesAllowed.some((roleKey) => actorRoleKeys.includes(roleKey))
  let hasRequiredPermissions = true
  for (const permission of requiredPermissions) {
    try {
      await assertRuntimePermission({
        scopes,
        customerId: toIdString(runtimeInstance?.customerId),
        tenantId: toIdString(runtimeInstance?.tenantId),
        permission,
      })
    } catch {
      hasRequiredPermissions = false
      break
    }
  }

  return {
    allowed: hasAllowedRole && hasRequiredPermissions,
    requiredPermissions,
    rolesAllowed,
  }
}

const buildRendererAction = ({
  action,
  policy,
  policyBinding,
  conditionResult,
  actionAccess,
  warningCode,
}) => {
  const governedAction = normalizeToken(action?.governedAction || policy?.governedAction || action?.actionKey || policy?.key)
  const actionKey = normalizeToken(action?.actionKey || governedAction || policy?.key)
  const policyKey = normalizeKey(policy?.key || policyBinding?.policyKey)
  const decisionMode = normalizeToken(policy?.decisionMode || WORKFLOW_POLICY_DECISION_MODES.ALLOW)
  const policyExecutable = Boolean(policy && isExecutablePolicyDecision(decisionMode))
  const actionVisible = action?.isVisible !== false
  const outputEnabled = Boolean(actionVisible && policyExecutable && conditionResult && actionAccess?.allowed)
  const disabledReason = !actionVisible
    ? 'Action is hidden by the UI Contract.'
    : !policy
      ? 'Action availability requires a matching active workflow policy.'
      : !policyExecutable
        ? 'Workflow policy decision mode is not executable by the renderer.'
        : !conditionResult
          ? 'Workflow policy runtime conditions are not currently satisfied.'
          : actionAccess?.allowed === false
            ? 'Current role or permissions do not allow this runtime action.'
            : 'Action availability is governed by active workflow policies and runtime state conditions.'

  return {
    actionKey,
    governedAction,
    buttonLabel: action?.buttonLabel || titleFromKey(governedAction || policyKey),
    enabled: outputEnabled,
    disabledReason: outputEnabled ? '' : disabledReason,
    requiresConfirmation: Boolean(action?.requiresConfirmation || action?.confirmationMessage),
    confirmationTitle: action?.confirmationTitle || '',
    confirmationMessage: action?.confirmationMessage || '',
    successMessage: action?.successMessage || policy?.passMessage || '',
    failureMessage: action?.failureMessage || policy?.failMessage || '',
    loadingMessage: action?.loadingMessage || '',
    triggerEvent: normalizeToken(policy?.triggerEvent),
    policyKey,
    policyDecisionMode: decisionMode,
    requiredPermissions: actionAccess?.requiredPermissions || [],
    rolesAllowed: actionAccess?.rolesAllowed || [],
    displayOrder: Number.isFinite(Number(action?.displayOrder))
      ? Number(action.displayOrder)
      : Number.isFinite(Number(policyBinding?.priority))
        ? Number(policyBinding.priority)
        : Number.isFinite(Number(policy?.priority))
          ? Number(policy.priority)
          : 1000,
    source: {
      uiContract: Boolean(action),
      workflowPolicy: Boolean(policy),
    },
    warnings: warningCode
      ? [warningCode]
      : [],
  }
}

const buildRendererActions = async ({
  frameworkPackage,
  uiContract,
  workflowPolicies,
  bindingByPolicyKey,
  runtimeContext,
  runtimeInstance,
  scopes,
  configWarnings,
}) => {
  const uiActions = Array.isArray(uiContract?.actions)
    ? uiContract.actions.filter((action) => action?.isVisible !== false)
    : []
  const policyByGovernedAction = new Map()

  workflowPolicies.forEach((policy) => {
    const governedAction = normalizeToken(policy?.governedAction)
    if (!governedAction) return
    const existing = policyByGovernedAction.get(governedAction)
    if (!existing || Number(policy.priority || 1000) < Number(existing.priority || 1000)) {
      policyByGovernedAction.set(governedAction, policy)
    }
  })

  const renderedActions = await Promise.all(uiActions.map(async (action) => {
    const governedAction = normalizeToken(action?.governedAction || action?.actionKey)
    const policy = policyByGovernedAction.get(governedAction) || null
    const policyBinding = bindingByPolicyKey.get(normalizeKey(policy?.key)) || null
    const conditionResult = policy ? evaluatePolicyConditions({ policy, runtimeContext }) : false
    const actionAccess = await getActionAccess({
      action,
      runtimeInstance,
      scopes,
      governedAction,
    })

    if (!policy) {
      configWarnings.push(createConfigWarning({
        code: CONFIG_WARNING_CODES.ACTION_POLICY_MISSING,
        message: 'UI Contract action has no matching active workflow policy and was disabled.',
        actionKey: normalizeToken(action?.actionKey),
        governedAction,
      }))
    }

    return applyRuntimeActionStateGate({
      action: buildRendererAction({
        action,
        policy,
        policyBinding,
        conditionResult,
        actionAccess,
        warningCode: policy ? '' : CONFIG_WARNING_CODES.ACTION_POLICY_MISSING,
      }),
      frameworkPackage,
      runtimeInstance,
      frameworkState: runtimeInstance.framework_state || {},
    })
  }))

  return renderedActions
    .sort((left, right) => left.displayOrder - right.displayOrder || left.actionKey.localeCompare(right.actionKey))
}

const resolveAnchorRuntimeInstance = async (anchor) => {
  const anchorRuntimeInstanceId = toIdString(anchor?.runtimeInstanceId)
  const anchorRuntimeInstanceKey = normalizeKey(anchor?.runtimeInstanceKey)
  const anchorQuery = {
    $or: [
      ...(mongoose.isValidObjectId(anchorRuntimeInstanceId) ? [{ _id: anchorRuntimeInstanceId }] : []),
      ...(anchorRuntimeInstanceKey ? [{ runtimeInstanceKey: anchorRuntimeInstanceKey }] : []),
    ],
  }

  if (anchorQuery.$or.length === 0) return null

  return RuntimeInstance.findOne(anchorQuery).lean()
}

const isDealAnalysisAnchorShape = (anchor) =>
  normalizeToken(anchor?.runtimeType) === RUNTIME_TYPES.VALUE_NARRATIVE
  && DEAL_ANALYSIS_ANCHOR_RELATIONSHIPS.has(normalizeToken(anchor?.relationship))
  && Boolean(anchor?.lockedAt)

const assertDealAnalysisAnchorRenderable = async (runtimeInstance) => {
  const anchors = Array.isArray(runtimeInstance.anchors) ? runtimeInstance.anchors : []
  const anchor = anchors.find(isDealAnalysisAnchorShape)

  if (!anchor) {
    throw createRuntimeRendererError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Deal Analysis rendering requires a locked VMF runtime anchor.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.DEAL_ANALYSIS_ANCHOR_REQUIRED,
      details: {
        runtimeInstanceId: runtimeInstance.id,
        runtimeType: runtimeInstance.runtimeType,
        anchorReason: 'LOCKED_VALUE_NARRATIVE_ANCHOR_REQUIRED',
      },
    })
  }

  const anchorRuntimeInstance = await resolveAnchorRuntimeInstance(anchor)
  const anchorEvidence = getRuntimeEvidence(anchorRuntimeInstance || {})
  const missingAnchorEvidence = Object.entries(anchorEvidence)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  const anchorChecks = {
    found: Boolean(anchorRuntimeInstance),
    runtimeType: normalizeToken(anchorRuntimeInstance?.runtimeType) === RUNTIME_TYPES.VALUE_NARRATIVE,
    frameworkKey: normalizeToken(anchorRuntimeInstance?.frameworkKey) === VMF_FRAMEWORK_KEY,
    customerId: toIdString(anchorRuntimeInstance?.customerId) === toIdString(runtimeInstance.customerId),
    tenantId: toIdString(anchorRuntimeInstance?.tenantId) === toIdString(runtimeInstance.tenantId),
    status: normalizeToken(anchorRuntimeInstance?.status) === RUNTIME_INSTANCE_STATUSES.LOCKED,
    evidence: missingAnchorEvidence.length === 0,
  }
  const failedChecks = Object.entries(anchorChecks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key)

  if (failedChecks.length > 0) {
    throw createRuntimeRendererError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Deal Analysis rendering requires a locked VMF runtime anchor in the same tenant scope.',
      reason: RUNTIME_RENDERER_ERROR_REASONS.DEAL_ANALYSIS_ANCHOR_REQUIRED,
      details: {
        runtimeInstanceId: runtimeInstance.id,
        runtimeType: runtimeInstance.runtimeType,
        anchorRuntimeInstanceId: toIdString(anchor.runtimeInstanceId),
        anchorRuntimeInstanceKey: anchor.runtimeInstanceKey || '',
        failedChecks,
        missingAnchorEvidence,
      },
    })
  }
}

const assertRuntimeTypeRenderable = async (runtimeInstance) => {
  const runtimeType = normalizeToken(runtimeInstance.runtimeType)

  if (runtimeType === RUNTIME_TYPES.DEAL_ANALYSIS) {
    await assertDealAnalysisAnchorRenderable(runtimeInstance)
  }
}

const buildRendererRuntimeInstance = (runtimeInstance) => {
  const { framework_state: _frameworkState, ...safeRuntimeInstance } = runtimeInstance || {}
  return safeRuntimeInstance
}

const isRuntimeDebugProjectionAllowed = (scopes = {}) => {
  const platformRoleKeys = uniqueTokens(
    Array.isArray(scopes?.resolvedPermissions?.platform?.roleKeys)
      ? scopes.resolvedPermissions.platform.roleKeys
      : [],
  )

  return platformRoleKeys.includes('SUPER_ADMIN')
}

const buildRuntimeDataProjection = ({ includeDebugProjection, sections }) => ({
  readablePaths: includeDebugProjection
    ? (Array.isArray(sections) ? sections : []).map((section) => ({
      sectionKey: section.sectionKey,
      runtimePath: section.runtimePath,
      value: section.value,
    }))
    : [],
})

const normalizeActivityText = (value) => String(value || '').trim()

const getActivitySummaryCount = (summary = {}, key) => {
  const count = Number(summary?.[key])
  return Number.isFinite(count) && count > 0 ? count : 0
}

const buildSafeDiscoveryResetEvidenceSummary = (summary = {}) => {
  if (!isProjectionObject(summary)) return {}

  return {
    accepted: Boolean(summary.accepted),
    stateStatus: normalizeActivityText(summary.stateStatus),
    inputCount: getActivitySummaryCount(summary, 'inputCount'),
    sourceCount: getActivitySummaryCount(summary, 'sourceCount'),
    sourceRegistryCount: getActivitySummaryCount(summary, 'sourceRegistryCount'),
    evidenceObjectCount: getActivitySummaryCount(summary, 'evidenceObjectCount'),
    scopedViewCount: getActivitySummaryCount(summary, 'scopedViewCount'),
    acceptedAt: normalizeActivityText(summary.acceptedAt),
    acquisitionProfile: normalizeActivityText(summary.acquisitionProfile),
  }
}

const buildDiscoveryResetActivityPayload = (entry = {}) => {
  const diff = isProjectionObject(entry.diff) ? entry.diff : {}
  if (normalizeToken(diff.reason) !== 'DISCOVERY_RESET') return null

  const clearedSectionTruthCount = Number.isFinite(Number(diff.clearedSectionTruthCount))
    ? Number(diff.clearedSectionTruthCount)
    : Array.isArray(diff.clearedSectionTruths)
      ? diff.clearedSectionTruths.length
      : 0

  return {
    reason: 'DISCOVERY_RESET',
    resetReason: normalizeActivityText(diff.resetReason),
    resetAt: normalizeActivityText(diff.resetAt),
    resetByLabel: normalizeActivityText(entry.display?.actorLabel),
    previousEvidenceSummary: buildSafeDiscoveryResetEvidenceSummary(diff.previousEvidenceSummary),
    nextEvidenceSummary: buildSafeDiscoveryResetEvidenceSummary(diff.nextEvidenceSummary),
    clearedSectionTruthCount,
  }
}

const sanitizeRuntimeActivitySummary = (value, entry = {}) => {
  const summary = normalizeActivityText(value)
  if (!summary) return ''

  const resourceId = toIdString(entry.resourceId)
  const normalizedSummary = summary.toLocaleLowerCase()
  if (resourceId && normalizedSummary.includes(resourceId.toLocaleLowerCase())) {
    return ''
  }

  return summary
}

const formatActivityTokenLabel = (value) => {
  const token = normalizeActivityText(value)
  if (!token) return ''

  return token
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
}

const buildRuntimeActionActivitySummary = (entry = {}) => {
  const actionKey = normalizeActivityText(entry.diff?.governedAction || entry.diff?.actionKey)
  const actionLabel = formatActivityTokenLabel(actionKey)
  return actionLabel ? `${actionLabel} executed` : ''
}

const buildRuntimeActivityEvent = (entry = {}) => {
  const eventId = toIdString(entry.id || entry._id)
  const occurredAtDate = entry.ts ? new Date(entry.ts) : null
  const occurredAt = occurredAtDate && !Number.isNaN(occurredAtDate.getTime())
    ? occurredAtDate.toISOString()
    : null
  const action = normalizeToken(entry.action)
  const discoveryReset = buildDiscoveryResetActivityPayload(entry)
  const actionSummary = action === 'RUNTIME_ACTION_EXECUTED'
    ? buildRuntimeActionActivitySummary(entry)
    : ''
  const summary = discoveryReset
    ? 'cleared Intelligence Hub evidence and section truth'
    : sanitizeRuntimeActivitySummary(entry.display?.title, entry)
    || actionSummary
    || sanitizeRuntimeActivitySummary(entry.summary, entry)
    || RUNTIME_ACTIVITY_SUMMARY_BY_ACTION[action]
    || normalizeActivityText(entry.action)

  return {
    ...(eventId ? { eventId } : {}),
    ...(entry.action ? { action: entry.action } : {}),
    ...(entry.diff?.actionKey ? { actionKey: normalizeActivityText(entry.diff.actionKey) } : {}),
    ...(entry.diff?.governedAction ? { governedAction: normalizeActivityText(entry.diff.governedAction) } : {}),
    ...(summary ? { summary } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    ...(entry.display?.actorLabel ? { actorLabel: normalizeActivityText(entry.display.actorLabel) } : {}),
    ...(discoveryReset ? { activityType: 'DISCOVERY_RESET', reset: discoveryReset } : {}),
  }
}

const resolveRuntimeActivity = async (runtimeInstance = {}) => {
  const runtimeInstanceId = toIdString(runtimeInstance.id || runtimeInstance._id)
  if (!runtimeInstanceId) return []

  const activityRows = await AuditLog.find({
    resourceType: RUNTIME_ACTIVITY_RESOURCE_TYPE,
    resourceId: runtimeInstanceId,
  })
    .sort({ ts: -1 })
    .limit(RUNTIME_ACTIVITY_LIMIT)
    .lean()

  return (Array.isArray(activityRows) ? activityRows : [])
    .map(buildRuntimeActivityEvent)
    .filter((event) => event.summary)
}

const buildValidationProjection = ({ frameworkState, sections }) => ({
  state: deriveValidationState(frameworkState),
  messages: (Array.isArray(sections) ? sections : [])
    .flatMap((section) => Array.isArray(section.validationMessages) ? section.validationMessages : []),
})

const buildSectionTruthReadinessProjection = ({
  runtimeInstance = {},
  frameworkState = {},
  sectionTruth = null,
} = {}) => {
  const projectedSectionTruth = sectionTruth || {}
  if (!isRuntimeLockedForInspection({ runtimeInstance, frameworkState })) {
    return projectedSectionTruth
  }

  return {
    ...projectedSectionTruth,
    sourceState: projectedSectionTruth.state || 'SECTION_TRUTH_NOT_CONFIGURED',
    state: 'SECTION_TRUTH_LOCKED',
    locked: true,
    readonlyReason: LOCKED_RUNTIME_READONLY_REASON,
  }
}

const buildReadinessProjection = (runtimeInstance = {}, frameworkState = {}, sectionTruth = null) => {
  const readiness = frameworkState.readiness || {}
  const state = deriveRuntimeReadinessState(frameworkState)

  return {
    state,
    ready: Boolean(readiness.ready),
    submittedForReview: Boolean(readiness.submittedForReview),
    validationState: readiness.validationState || '',
    lastActionKey: readiness.lastActionKey || '',
    updatedAt: readiness.updatedAt || null,
    updatedBy: readiness.updatedBy || '',
    sectionTruth: buildSectionTruthReadinessProjection({
      runtimeInstance,
      frameworkState,
      sectionTruth,
    }),
  }
}

const buildPublishProjection = (frameworkState = {}, sectionTruth = null) => {
  const publish = frameworkState.publish || {}
  const sectionTruthReady = sectionTruth?.publishEligible === true
  const outputEligibility = publish.outputEligibility || {}
  return {
    state: publish.state || (publish.published ? 'PUBLISHED' : 'UNPUBLISHED'),
    published: Boolean(publish.published),
    publishedAt: publish.publishedAt || null,
    publishedBy: publish.publishedBy || '',
    outputEligible: Boolean(publish.outputEligible && sectionTruthReady),
    outputEligibility: {
      ...outputEligibility,
      outputEligible: Boolean(outputEligibility.outputEligible && sectionTruthReady),
      sectionTruthReady,
    },
    publishVersion: publish.publishVersion || null,
    snapshot: publish.snapshot || {},
    sectionTruthReady,
    sectionTruth: sectionTruth || {},
    evidence: publish.evidence || {},
    sourceApproval: publish.sourceApproval || {},
  }
}

const buildLockProjection = (runtimeInstance = {}, frameworkState = {}, sectionTruth = null) => {
  const lock = frameworkState.lock || {}
  const lockedAt = runtimeInstance.lockedAt || lock.lockedAt || null
  const sectionTruthReady = sectionTruth?.lockEligible === true
  const outputEligibility = lock.outputEligibility || {}
  const anchor = lock.replayAnchor || lock.anchor || {}
  return {
    state: lock.state || (lockedAt ? 'LOCKED' : 'UNLOCKED'),
    locked: Boolean(
      lock.locked
      || lockedAt
      || normalizeToken(runtimeInstance.status) === RUNTIME_INSTANCE_STATUSES.LOCKED,
    ),
    lockedAt,
    lockedBy: runtimeInstance.lockedBy || lock.lockedBy || '',
    lockedReason: runtimeInstance.lockedReason || lock.lockedReason || '',
    lockEligible: sectionTruthReady,
    outputEligible: Boolean(lock.locked && outputEligibility.outputEligible && sectionTruthReady),
    outputEligibility: {
      ...outputEligibility,
      outputEligible: Boolean(outputEligibility.outputEligible && sectionTruthReady),
      sectionTruthReady,
    },
    lockVersion: lock.lockVersion || null,
    snapshot: lock.snapshot || {},
    sectionTruthReady,
    sectionTruth: sectionTruth || {},
    evidence: lock.evidence || {},
    anchor,
    replayAnchor: anchor,
  }
}

const hasSnapshotProof = (snapshot = {}) =>
  Boolean(String(snapshot.snapshotId || snapshot.id || '').trim())
  && Boolean(String(snapshot.snapshotHash || snapshot.hash || '').trim())

const hasReplayAnchorProof = (anchor = {}) =>
  Boolean(String(anchor.replayAnchorId || anchor.anchorId || anchor.id || '').trim())
  && Boolean(String(anchor.replayAnchorHash || anchor.anchorHash || anchor.hash || '').trim())

const resolveMaybeLean = async (queryOrValue) => {
  if (queryOrValue && typeof queryOrValue.lean === 'function') {
    return await queryOrValue.lean()
  }

  return queryOrValue
}

const canUpdateRuntime = async ({ runtimeInstance, scopes }) => {
  try {
    await assertRuntimePermission({
      actorUserId: scopes?.userId,
      scopes,
      customerId: runtimeInstance.customerId,
      tenantId: runtimeInstance.tenantId,
      permission: 'VMF_UPDATE',
    })
    return true
  } catch {
    return false
  }
}

const buildRevisionLineageItem = ({
  runtimeInstanceId,
  runtimeInstanceKey,
  revisionNumber,
  relationship,
  status,
  lifecycleStage,
} = {}) => ({
  runtimeInstanceId: toIdString(runtimeInstanceId),
  runtimeInstanceKey: runtimeInstanceKey || '',
  revisionNumber: Number(revisionNumber) > 0 ? Number(revisionNumber) : 1,
  relationship,
  status: status || '',
  lifecycleStage: lifecycleStage || '',
})

const buildRevisionProjection = async ({
  runtimeInstance,
  frameworkState,
  publish,
  lock,
  scopes,
} = {}) => {
  const revision = runtimeInstance.revision || {}
  const revisionNumber = Number(revision.revisionNumber) > 0 ? Number(revision.revisionNumber) : 1
  const hasUpdatePermission = await canUpdateRuntime({ runtimeInstance, scopes })
  const childRevision = hasUpdatePermission
    ? await resolveMaybeLean(RuntimeInstance.findOne({
      customerId: runtimeInstance.customerId,
      tenantId: runtimeInstance.tenantId,
      'revision.parentRuntimeId': runtimeInstance.id || runtimeInstance._id,
    }))
    : null
  const runtimeType = normalizeToken(runtimeInstance.runtimeType)
  const runtimeStatus = normalizeToken(runtimeInstance.status)
  const publishReady = publish?.published === true
    && normalizeToken(publish?.state) === 'PUBLISHED'
    && hasSnapshotProof(publish?.snapshot)
  const lockReady = lock?.locked === true
    && normalizeToken(lock?.state) === 'LOCKED'
    && runtimeStatus === RUNTIME_INSTANCE_STATUSES.LOCKED
    && hasSnapshotProof(lock?.snapshot)
    && hasReplayAnchorProof(lock?.replayAnchor || lock?.anchor)
  const lineage = [
    ...(revision.parentRuntimeId ? [buildRevisionLineageItem({
      runtimeInstanceId: revision.parentRuntimeId,
      runtimeInstanceKey: revision.parentRuntimeInstanceKey,
      revisionNumber: revision.createdFromRevision,
      relationship: 'PARENT',
      status: 'LOCKED',
      lifecycleStage: 'LOCKED',
    })] : []),
    buildRevisionLineageItem({
      runtimeInstanceId: runtimeInstance.id || runtimeInstance._id,
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
      revisionNumber,
      relationship: 'CURRENT',
      status: runtimeInstance.status,
      lifecycleStage: frameworkState?.lifecycle?.stage || '',
    }),
    ...(childRevision ? [buildRevisionLineageItem({
      runtimeInstanceId: childRevision._id || childRevision.id,
      runtimeInstanceKey: childRevision.runtimeInstanceKey,
      revisionNumber: childRevision.revision?.revisionNumber,
      relationship: 'CHILD',
      status: childRevision.status,
      lifecycleStage: childRevision.framework_state?.lifecycle?.stage || '',
    })] : []),
  ]

  let disabledReason = ''
  if (runtimeType !== RUNTIME_TYPES.VALUE_NARRATIVE) {
    disabledReason = 'Only Value Narrative runtimes can create revisions.'
  } else if (!hasUpdatePermission) {
    disabledReason = 'VMF update permission is required to create a revision.'
  } else if (!publishReady) {
    disabledReason = 'Publish snapshot proof is required before creating a revision.'
  } else if (!lockReady) {
    disabledReason = 'Lock snapshot and replay anchor proof are required before creating a revision.'
  } else if (childRevision) {
    disabledReason = 'A revision already exists for this locked runtime.'
  }

  return {
    contractVersion: 'runtime-revision.v1',
    revisionNumber,
    rootRuntimeId: toIdString(revision.rootRuntimeId || runtimeInstance.id || runtimeInstance._id),
    rootRuntimeInstanceKey: revision.rootRuntimeInstanceKey || runtimeInstance.runtimeInstanceKey || '',
    parentRuntimeId: revision.parentRuntimeId ? toIdString(revision.parentRuntimeId) : null,
    parentRuntimeInstanceKey: revision.parentRuntimeInstanceKey || '',
    lineage,
    createRevision: {
      enabled: !disabledReason,
      disabledReason,
      permission: 'VMF_UPDATE',
      expectedUpdatedAt: runtimeInstance.updatedAt || null,
      existingChildRuntimeId: childRevision ? toIdString(childRevision._id || childRevision.id) : null,
      existingChildRuntimeInstanceKey: childRevision?.runtimeInstanceKey || '',
    },
    sourceProof: {
      publishSnapshotId: publish?.snapshot?.snapshotId || '',
      publishSnapshotHash: publish?.snapshot?.snapshotHash || '',
      lockSnapshotId: lock?.snapshot?.snapshotId || '',
      lockSnapshotHash: lock?.snapshot?.snapshotHash || '',
      replayAnchorId: lock?.replayAnchor?.replayAnchorId || lock?.anchor?.replayAnchorId || '',
      replayAnchorHash: lock?.replayAnchor?.replayAnchorHash || lock?.anchor?.replayAnchorHash || '',
    },
  }
}

export const getRuntimeRenderer = async ({
  scopes,
  runtimeInstanceId,
} = {}) => {
  const runtimeInstance = await getRuntimeInstance({ scopes, runtimeInstanceId })
  await assertRuntimeTypeRenderable(runtimeInstance)

  const frameworkPackage = await resolvePackage({ runtimeInstance })
  const [uiContract, runtimePathRecords, workflowPolicyContext] = await Promise.all([
    resolveUIContract({ frameworkPackage }),
    resolveRuntimePathRecords({ frameworkPackage }),
    resolveWorkflowPolicies({ frameworkPackage }),
  ])
  const configWarnings = []
  const runtimeContext = buildRuntimeContext(runtimeInstance)
  const mutationAccess = await resolveSectionMutationAccess({ runtimeInstance, scopes })
  const frameworkState = runtimeInstance.framework_state || {}
  const discovery = buildDiscoveryProjection(frameworkState, {
    includeInputValues: mutationAccess?.allowed === true,
  })
  const sections = buildRendererSections({
    discovery,
    frameworkPackage,
    mutationAccess,
    runtimeInstance,
    runtimePathRecords,
    uiContract,
    configWarnings,
  })
  const actions = await buildRendererActions({
    frameworkPackage,
    uiContract,
    workflowPolicies: workflowPolicyContext.policies,
    bindingByPolicyKey: workflowPolicyContext.bindingByPolicyKey,
    runtimeContext,
    runtimeInstance,
    scopes,
    configWarnings,
  })
  const workspaceId = runtimeInstance.workspaceId || runtimeInstance.id
  const includeDebugProjection = isRuntimeDebugProjectionAllowed(scopes)
  const activity = await resolveRuntimeActivity(runtimeInstance)
  const sectionTruth = evaluateRuntimeSectionTruthReadiness({
    frameworkPackage,
    frameworkState,
  })
  const publishProjection = buildPublishProjection(frameworkState, sectionTruth)
  const lockProjection = buildLockProjection(runtimeInstance, frameworkState, sectionTruth)
  const revisionProjection = await buildRevisionProjection({
    runtimeInstance,
    frameworkState,
    publish: publishProjection,
    lock: lockProjection,
    scopes,
  })

  return {
    rendererContractVersion: RUNTIME_RENDERER_CONTRACT_VERSION,
    runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
    projectionGeneratedAt: new Date().toISOString(),
    runtimeInstance: buildRendererRuntimeInstance(runtimeInstance),
    workspace: {
      workspaceId,
      workspaceKey: runtimeInstance.workspaceId || runtimeInstance.runtimeInstanceKey || runtimeInstance.id,
      routeKey: runtimeInstance.id,
    },
    package: {
      packageId: toIdString(frameworkPackage._id || frameworkPackage.id),
      packageKey: frameworkPackage.packageKey,
      packageName: frameworkPackage.packageName,
      frameworkKey: frameworkPackage.frameworkKey,
      frameworkVersion: frameworkPackage.version,
      deploymentId: runtimeInstance.deploymentId,
      activationId: runtimeInstance.activationId,
      snapshotId: runtimeInstance.dependencyLockId || runtimeInstance.evidence?.dependencySnapshotId || '',
      uiContractKey: normalizeKey(frameworkPackage.uiContractBinding?.key || frameworkPackage.uiContractKey),
    },
    lifecycle: {
      runtimeStatus: runtimeInstance.status,
      executionStatus: runtimeInstance.executionStatus,
      runtimeMode: runtimeInstance.runtimeMode,
      stage: frameworkState.lifecycle?.stage || 'DRAFT',
    },
    discovery,
    sections,
    actions,
    validation: buildValidationProjection({ frameworkState, sections }),
    readiness: buildReadinessProjection(runtimeInstance, frameworkState, sectionTruth),
    publish: publishProjection,
    lock: lockProjection,
    revision: revisionProjection,
    signals: [],
    activity,
    runtimeData: buildRuntimeDataProjection({ includeDebugProjection, sections }),
    diagnostics: {
      renderTraceId: `render-${randomUUID()}`,
      runtimePathVisibility: includeDebugProjection ? 'VISIBLE' : 'HIDDEN',
      configWarnings,
      configErrors: [],
    },
  }
}

const runtimeRendererService = {
  getRuntimeRenderer,
}

export default runtimeRendererService
