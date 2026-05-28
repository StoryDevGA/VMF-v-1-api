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

const SECTION_WRITE_SCOPE = 'framework_state.sections.*'
export const DISCOVERY_EVIDENCE_PACK_PATH = 'framework_state.evidence_pack'
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
const DISCOVERY_INPUT_KEYS = ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer', 'notes']
const REQUIRED_DISCOVERY_INPUT_KEYS = ['companyWebsite', 'companyName', 'marketRegion', 'targetOffer']

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

const hasRequiredDiscoveryInputs = (inputs) =>
  inputs
  && typeof inputs === 'object'
  && !Array.isArray(inputs)
  && REQUIRED_DISCOVERY_INPUT_KEYS.every((key) => String(inputs[key] ?? '').trim())

const hasDeterministicDiscoveryEvidence = (evidence, inputs) => {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false
  if (evidence.source !== 'DISCOVERY_INPUTS') return false
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

export const assertDiscoveryEvidenceAcceptable = (evidencePack) => {
  if (!evidencePack || Object.keys(evidencePack).length === 0) {
    throw buildDiscoveryAcceptanceUnavailableError('Discovery evidence must be refreshed before it can be accepted.')
  }

  const inputComplete = getEvidencePackStateFlag(evidencePack, 'inputComplete')
  const evidenceReady = getEvidencePackStateFlag(evidencePack, 'evidenceReady')
  const needsRefresh = getEvidencePackNeedsRefresh(evidencePack)
  const accepted = !needsRefresh && getEvidencePackStateFlag(evidencePack, 'accepted')

  if (!inputComplete || !evidenceReady) {
    throw buildDiscoveryAcceptanceUnavailableError('Discovery evidence is not ready for acceptance.')
  }

  if (needsRefresh) {
    throw buildDiscoveryAcceptanceUnavailableError('Discovery evidence must be refreshed before acceptance.')
  }

  if (accepted) {
    throw buildDiscoveryAcceptanceUnavailableError('Discovery evidence is already accepted.')
  }

  if (
    !hasRequiredDiscoveryInputs(evidencePack.inputs)
    || !hasDeterministicDiscoveryEvidence(evidencePack.evidence, evidencePack.inputs)
    || !hasDiscoveryLineage(evidencePack)
  ) {
    throw buildDiscoveryAcceptanceUnavailableError('Discovery evidence is incomplete and must be refreshed before acceptance.')
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
  },
  mutation: {
    runtimePath: DISCOVERY_EVIDENCE_PACK_PATH,
    operation: RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE,
    previousValue: previousEvidencePack,
    value: cloneValue(evidencePack),
  },
})

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

const normalizeDiscoveryInputs = (inputs = {}) => DISCOVERY_INPUT_KEYS.reduce((normalized, key) => {
  const value = String(inputs?.[key] ?? '').trim()
  if (value) normalized[key] = value
  return normalized
}, {})

export const buildDiscoveryEvidencePack = async ({
  actorUserId,
  inputs,
  previousEvidencePack = {},
  reason = 'BUILD_EVIDENCE_PACK',
  runtimeInstance,
}) => {
  const normalizedInputs = normalizeDiscoveryInputs(inputs)
  const inputKeys = Object.keys(normalizedInputs)
  const missingInputKeys = REQUIRED_DISCOVERY_INPUT_KEYS.filter((key) => !normalizedInputs[key])
  const inputComplete = missingInputKeys.length === 0
  const evidenceReady = inputComplete
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
  const sourceRefs = inputKeys.map((key) => `input_${key}`)
  const sources = inputKeys.map((key) => ({
    sourceId: `input_${key}`,
    type: key === 'companyWebsite' ? 'USER_PROVIDED_WEBSITE' : 'USER_PROVIDED_INPUT',
    fieldKey: key,
    ...(key === 'companyWebsite' ? { url: normalizedInputs[key] } : {}),
    valueHash: hashDiscoveryValue(normalizedInputs[key]),
    status: 'USER_PROVIDED',
    capturedAt: refreshedAt,
  }))
  const compactSummary = {
    summary: `Customer-provided discovery inputs captured for ${
      normalizedInputs.companyName || normalizedInputs.companyWebsite || 'this runtime'
    }.`,
    confidence: 'USER_PROVIDED',
    sourceRefs,
    inputHash,
    refreshedAt,
  }
  const scopedViews = evidenceReady
    ? projectableSections.reduce((views, section) => {
        const sectionKey = normalizeSectionKey(section?.sectionKey)
        if (!sectionKey) return views
        views[sectionKey] = {
          source: 'DISCOVERY_EVIDENCE_PACK',
          summary: 'Customer-provided discovery inputs are available for this section.',
          inputKeys,
          evidenceKeys: ['summaries.compact', 'discovery.seedProfile'],
          sourceRefs,
          refreshedAt,
          evidenceHash: hashDiscoveryValue({
            sectionKey,
            inputHash,
            sourceRefs,
          }),
        }
        return views
      }, {})
    : {}
  const evidence = {
    source: 'DISCOVERY_INPUTS',
    inputKeys,
    requiredInputKeys: REQUIRED_DISCOVERY_INPUT_KEYS,
    missingInputKeys,
    builtAt: refreshedAt,
    inputHash,
    sourceRefs,
    sourceCount: sources.length,
  }
  const evidenceHash = hashDiscoveryValue({ evidence, summaries: { compact: compactSummary }, scopedViews })
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
    },
  ]

  return {
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
    },
    evidence,
    scoped_views: scopedViews,
    lineage: {
      sources,
      builder: {
        mode: 'DETERMINISTIC',
        version: 'discovery-evidence-pack-v1',
        adapter: 'customer-input',
      },
    },
    revisions,
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

const buildSectionAcceptanceUnavailableError = ({ message, runtimePath, sectionKey }) => buildMutationError({
  status: 409,
  code: 'CONFLICT',
  message,
  reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
  details: { runtimePath, sectionKey },
})

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
    inputHash: generated.inputHash || '',
    runtimePath,
    sectionKey,
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
    actorUserId,
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

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    auditRequest,
    runtimeInstance,
    nextFrameworkState,
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
  const nextEvidencePack = {
    ...previousEvidencePack,
    inputComplete: true,
    evidenceReady: true,
    accepted: true,
    needsRefresh: false,
    acceptedAt,
    acceptedBy: toIdString(actorUserId),
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

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    auditRequest,
    runtimeInstance,
    nextFrameworkState,
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
      accepted: !getEvidencePackNeedsRefresh(evidencePack) && getEvidencePackStateFlag(evidencePack, 'accepted'),
      needsRefresh: getEvidencePackNeedsRefresh(evidencePack),
      lineage,
      inputSummary: buildEvidenceSummaryProjection(evidencePack.inputs),
      evidenceSummary: buildEvidenceSummaryProjection(evidencePack.evidence),
      summarySummary: buildEvidenceSummaryProjection(summaries),
      scopedViewSummary: buildEvidenceSummaryProjection(scopedViews),
      canViewRawEvidence,
      ...(canViewRawEvidence ? {
        inputs: evidencePack.inputs || {},
        discovery: evidencePack.discovery || {},
        summaries,
        evidence: evidencePack.evidence || {},
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

  const updatedRuntimeInstance = await persistMutationWithAudit({
    actorUserId,
    additionalDiff: buildDependencyInvalidationAuditDiff(dependencyInvalidations),
    auditRequest,
    runtimeInstance,
    nextFrameworkState,
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
  updateRuntimeDiscoveryInputs,
}

export default runtimeStateMutationService
