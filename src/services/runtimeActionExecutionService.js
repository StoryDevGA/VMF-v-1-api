import mongoose from 'mongoose'
import { FrameworkPackage, RuntimeInstance } from '../models/index.js'
import { RUNTIME_TYPES } from '../models/RuntimeInstance.js'
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
  buildDiscoveryProjection,
  buildSectionGenerationEligibility,
  getDependencySectionKeys,
  getRuntimeRenderer,
} from './runtimeRendererService.js'
import {
  RUNTIME_ACTION_KEYS,
  buildRuntimeActionTransition,
  cloneRuntimeActionValue,
  getRuntimeActionStateGate,
  isSupportedSprint2RuntimeAction,
  normalizeRuntimeActionToken,
} from './runtimeActionPolicyService.js'
import {
  createNextRuntimeStateVersion,
  requireCanonicalRuntimeStateVersion,
} from './runtimeStateVersionService.js'
import {
  RUNTIME_SECTION_STATES,
  evaluateSectionInterpretationSimilarity,
  buildRuntimeSectionRevision,
  buildSectionIntelligenceDisplayProjection,
  cloneSectionValue,
  getRuntimeSectionAccepted,
  getRuntimeSectionGenerated,
  getRuntimeSectionInput,
  getRuntimeSectionRevisions,
  hashSectionInput,
  invalidateRuntimeSectionEvidence,
  normalizeRuntimeSectionObject,
} from './runtimeSectionModelService.js'
import { buildReasonedGeneratedSection } from './runtimeSectionReasoningService.js'
import { resolveSectionExecutionContract } from './sectionExecutionContractService.js'
import { executeSectionValidationRules } from './sectionValidationExecutorService.js'
import {
  acceptPendingDiscoveryEvidenceObjects,
  buildAcceptedDiscoveryScopedViews,
  buildDiscoveryEvidenceReviewSummary,
  buildDiscoveryHealth,
  buildDiscoverySourceRegistry,
  normalizeDiscoveryEvidenceObjects,
} from './discoveryIntelligenceService.js'
import {
  assertDiscoveryEvidenceAcceptable,
  assertRuntimeEvidencePackWritable,
  buildDiscoveryEvidencePack,
} from './runtimeStateMutationService.js'
import {
  buildRuntimeIntelligenceGraphAuditSummary,
  buildRuntimeIntelligenceGraphForFrameworkState,
  RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS,
} from './runtimeIntelligenceGraphService.js'
import {
  finalizeRuntimeStateGraphSourceMutation,
  stageRuntimeStateGraphSourceMutation,
} from './runtimeStateGraphSourceMutationService.js'
import { stageRuntimeStateSourceRollover } from './runtimeStateSourceRolloverService.js'

const buildActionError = ({
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

const normalizeUpdatedAtDate = (updatedAt) => {
  const updatedAtDate = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  return Number.isFinite(updatedAtDate.getTime()) ? updatedAtDate : null
}

const serializeErrorDetails = (err) => ({
  name: err?.name || 'Error',
  message: err?.message || 'Unknown error',
  ...(err?.code ? { code: err.code } : {}),
})

const normalizeActionString = (value) => String(value || '').trim()

const normalizeRuntimeSectionIdentity = (value) => normalizeActionString(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')

const parseRuntimeTimestamp = (value) => {
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

const hasRuntimeValue = (value) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

const isPlainRuntimeActionObject = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const buildAcceptedDiscoveryCoverageForAction = (coverage = {}) => {
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

const getGenerationPackageContext = ({ frameworkPackage, runtimeInstance } = {}) => ({
  packageKey: normalizeActionString(runtimeInstance?.packageKey || frameworkPackage?.packageKey),
  packageVersion: normalizeActionString(runtimeInstance?.packageVersion || frameworkPackage?.version),
})

const getGeneratedPackageContext = (generated = {}) => ({
  packageKey: normalizeActionString(generated?.generator?.packageKey),
  packageVersion: normalizeActionString(generated?.generator?.packageVersion),
})

const hasActiveDependencyInvalidation = (sectionObject = {}) => {
  const dependencies = sectionObject.dependencies || {}
  return (
    normalizeRuntimeActionToken(dependencies.state) === 'DEPENDENCY_CONTEXT_INVALIDATED'
    || (
      Array.isArray(dependencies.invalidatedSectionKeys)
      && dependencies.invalidatedSectionKeys.some((sectionKey) => normalizeActionString(sectionKey))
    )
  )
}

const hasActiveSectionEvidenceInvalidation = (sectionObject = {}) => {
  const state = sectionObject.state || {}
  const lineage = sectionObject.lineage || {}
  const intelligence = sectionObject.intelligence || {}
  return (
    normalizeActionString(state.acceptedInvalidationReason) === 'SECTION_EVIDENCE_CHANGED'
    || normalizeActionString(state.sectionEvidenceInvalidationReason) === 'SECTION_EVIDENCE_CHANGED'
    || normalizeActionString(lineage.sectionEvidenceInvalidationReason) === 'SECTION_EVIDENCE_CHANGED'
    || normalizeActionString(intelligence.invalidation?.reason) === 'SECTION_EVIDENCE_CHANGED'
  )
}

const clearRuntimeSectionRegenerationState = (state = {}) => {
  const nextState = isPlainRuntimeActionObject(state) ? { ...state } : {}
  delete nextState.needsRegeneration
  delete nextState.dependencyStatus
  delete nextState.sectionEvidenceInvalidatedAt
  delete nextState.sectionEvidenceInvalidatedBy
  delete nextState.sectionEvidenceInvalidationReason
  delete nextState.acceptedInvalidatedAt
  delete nextState.acceptedInvalidationReason
  return nextState
}

const clearRuntimeSectionRegenerationLineage = (lineage = {}) => {
  const nextLineage = isPlainRuntimeActionObject(lineage) ? { ...lineage } : {}
  delete nextLineage.sectionEvidenceInvalidatedAt
  delete nextLineage.sectionEvidenceInvalidatedBy
  delete nextLineage.sectionEvidenceInvalidationReason
  return nextLineage
}

const clearRuntimeSectionRegenerationIntelligence = (intelligence = {}) => {
  const nextIntelligence = isPlainRuntimeActionObject(intelligence) ? { ...intelligence } : {}
  if (normalizeActionString(nextIntelligence.invalidation?.reason) === 'SECTION_EVIDENCE_CHANGED') {
    delete nextIntelligence.invalidation
  }
  return nextIntelligence
}

const getSectionTruthTimestamp = ({ accepted, generated } = {}) => {
  const generatedAt = parseRuntimeTimestamp(generated?.generatedAt)
  const sourceGeneratedAt = parseRuntimeTimestamp(accepted?.sourceGeneratedAt)
  const acceptedAt = parseRuntimeTimestamp(accepted?.acceptedAt)
  return generatedAt || sourceGeneratedAt || acceptedAt
}

const getPackageSectionByKey = ({ frameworkPackage, sectionKey } = {}) => {
  const normalizedSectionKey = normalizeRuntimeSectionIdentity(sectionKey)
  return (Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : [])
    .find((section) => normalizeRuntimeSectionIdentity(section?.sectionKey || section?.key) === normalizedSectionKey)
}

const getFrameworkStateSectionValue = ({ frameworkPackage, frameworkState, sectionKey } = {}) => {
  const packageSection = getPackageSectionByKey({ frameworkPackage, sectionKey })
  const stateSectionKey = getRuntimeSectionStateKey({
    runtimePath: packageSection?.runtimePath,
    sectionKey,
  })

  return frameworkState?.sections?.[stateSectionKey] ?? frameworkState?.sections?.[sectionKey]
}

const getLatestRuntimeSectionRevisionValue = (revisions, key) => {
  if (!Array.isArray(revisions)) return null
  for (let index = revisions.length - 1; index >= 0; index -= 1) {
    if (hasRuntimeValue(revisions[index]?.[key])) return revisions[index]
  }
  return null
}

const getTimestampInvalidatedDependencySectionKeys = ({
  dependencySectionKeys,
  frameworkPackage,
  frameworkState,
  previousGenerated,
  sectionObject,
} = {}) => {
  const accepted = getRuntimeSectionAccepted(sectionObject)
  const sectionTruthTimestamp = getSectionTruthTimestamp({
    accepted,
    generated: previousGenerated,
  })
  if (!sectionTruthTimestamp) return []

  return (Array.isArray(dependencySectionKeys) ? dependencySectionKeys : [])
    .map(normalizeActionString)
    .filter(Boolean)
    .filter((dependencySectionKey) => {
      const dependencyValue = getFrameworkStateSectionValue({
        frameworkPackage,
        frameworkState,
        sectionKey: dependencySectionKey,
      })
      const dependencyAccepted = getRuntimeSectionAccepted(dependencyValue)
      if (!hasRuntimeValue(dependencyAccepted?.content ?? dependencyAccepted)) return false

      const dependencyAcceptedAt = parseRuntimeTimestamp(dependencyAccepted?.acceptedAt)
      return dependencyAcceptedAt && dependencyAcceptedAt > sectionTruthTimestamp
    })
}

const buildRegenerationEligibility = ({
  dependencySectionKeys,
  frameworkPackage,
  frameworkState,
  input,
  payload,
  previousGenerated,
  runtimeInstance,
  section,
  sectionObject,
} = {}) => {
  const reasons = []
  const currentInputHash = hashSectionInput(input)
  const previousInputHash = normalizeActionString(previousGenerated?.inputHash)
  const forceRegenerateReason = normalizeActionString(payload?.forceRegenerateReason)
  const currentIntelligence = buildSectionIntelligenceDisplayProjection({
    dependencySectionKeys,
    frameworkPackage,
    frameworkState,
    input,
    runtimeInstance,
    section,
  })
  const currentEvidenceHash = normalizeActionString(currentIntelligence?.boundedContext?.evidenceHash)
  const previousEvidenceHash = normalizeActionString(previousGenerated?.evidenceHash)
  const currentSectionEvidenceHash = normalizeActionString(currentIntelligence?.boundedContext?.sectionEvidenceHash)
  const previousSectionEvidenceHash = normalizeActionString(previousGenerated?.sectionEvidenceHash)
  const currentDependencyHash = normalizeActionString(currentIntelligence?.boundedContext?.dependencyHash)
  const previousDependencyHash = normalizeActionString(previousGenerated?.dependencyHash)

  if (forceRegenerateReason) reasons.push('FORCED_REGENERATE_REASON')

  if (!previousInputHash) {
    reasons.push('MISSING_GENERATION_INPUT_HASH')
  } else if (currentInputHash !== previousInputHash) {
    reasons.push('INPUT_CHANGED')
  }

  if (previousSectionEvidenceHash && currentSectionEvidenceHash && currentSectionEvidenceHash !== previousSectionEvidenceHash) {
    reasons.push('SECTION_EVIDENCE_CHANGED')
  } else if (hasActiveSectionEvidenceInvalidation(sectionObject)) {
    reasons.push('SECTION_EVIDENCE_CHANGED')
  } else if (previousEvidenceHash && currentEvidenceHash && currentEvidenceHash !== previousEvidenceHash) {
    reasons.push('DISCOVERY_EVIDENCE_CHANGED')
  }

  if (previousDependencyHash && currentDependencyHash && currentDependencyHash !== previousDependencyHash) {
    reasons.push('DEPENDENCY_CONTEXT_CHANGED')
  }

  if (hasActiveDependencyInvalidation(sectionObject)) {
    reasons.push('DEPENDENCY_CONTEXT_INVALIDATED')
  }

  const timestampInvalidatedSectionKeys = getTimestampInvalidatedDependencySectionKeys({
    dependencySectionKeys,
    frameworkPackage,
    frameworkState,
    previousGenerated,
    sectionObject,
  })
  if (timestampInvalidatedSectionKeys.length > 0) {
    reasons.push('DEPENDENCY_CONTEXT_INVALIDATED')
  }

  const currentPackageContext = getGenerationPackageContext({ frameworkPackage, runtimeInstance })
  const generatedPackageContext = getGeneratedPackageContext(previousGenerated)
  if (!generatedPackageContext.packageKey || !generatedPackageContext.packageVersion) {
    reasons.push('MISSING_PACKAGE_GENERATION_METADATA')
  } else if (
    generatedPackageContext.packageKey !== currentPackageContext.packageKey
    || generatedPackageContext.packageVersion !== currentPackageContext.packageVersion
  ) {
    reasons.push('PACKAGE_CONTEXT_CHANGED')
  }

  return {
    canRegenerate: reasons.length > 0,
    currentInputHash,
    currentEvidenceHash,
    currentSectionEvidenceHash,
    currentDependencyHash,
    previousInputHash,
    previousEvidenceHash,
    previousSectionEvidenceHash,
    previousDependencyHash,
    forceRegenerateReason,
    invalidatedDependencySectionKeys: timestampInvalidatedSectionKeys,
    reasons: [...new Set(reasons)],
  }
}

const buildStaleActionError = ({ runtimeInstance, expectedUpdatedAt, currentUpdatedAt }) =>
  buildActionError({
    status: 409,
    code: 'CONFLICT',
    message: 'Runtime instance has changed since the action projection was loaded.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_STALE,
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
    throw buildStaleActionError({ runtimeInstance, expectedUpdatedAt })
  }
}

const resolveRuntimeInstanceDocument = async ({ runtimeInstanceId }) => {
  const runtimeInstance = await RuntimeInstance.findOne({
    $or: [
      ...(mongoose.isValidObjectId(runtimeInstanceId) ? [{ _id: runtimeInstanceId }] : []),
      { runtimeInstanceKey: String(runtimeInstanceId || '').trim().toLowerCase() },
    ],
  })

  if (!runtimeInstance) {
    throw buildActionError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Runtime instance not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_INSTANCE_NOT_FOUND,
      details: { runtimeInstanceId },
    })
  }

  return runtimeInstance
}

const assertSupportedRuntimeType = (runtimeInstance) => {
  const runtimeType = normalizeToken(runtimeInstance?.runtimeType)
  if (runtimeType === RUNTIME_TYPES.VALUE_NARRATIVE) return

  throw buildActionError({
    status: 422,
    code: 'VALIDATION_FAILED',
    message: 'Runtime action execution is only available for Value Narrative runtimes in Sprint 2.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_UNSUPPORTED_RUNTIME_TYPE,
    details: {
      runtimeType,
      supportedRuntimeTypes: [RUNTIME_TYPES.VALUE_NARRATIVE],
    },
  })
}

const assertActionSupported = (actionKey) => {
  if (isSupportedSprint2RuntimeAction(actionKey)) return

  throw buildActionError({
    status: 422,
    code: 'VALIDATION_FAILED',
    message: 'Runtime action is not supported in Sprint 2.',
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_UNSUPPORTED,
    details: {
      actionKey,
      supportedActions: Object.values(RUNTIME_ACTION_KEYS),
    },
  })
}

const resolveRendererAction = ({ renderer, actionKey }) => {
  const normalizedActionKey = normalizeRuntimeActionToken(actionKey)
  const action = (Array.isArray(renderer?.actions) ? renderer.actions : [])
    .find((candidate) =>
      normalizeRuntimeActionToken(candidate?.actionKey) === normalizedActionKey
      || normalizeRuntimeActionToken(candidate?.governedAction) === normalizedActionKey,
    )

  if (!action) {
    throw buildActionError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime action is not declared by the renderer projection.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_DECLARED,
      details: { actionKey: normalizedActionKey },
    })
  }

  if (!action.enabled) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime action is not currently executable.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        disabledReason: action.disabledReason || 'Runtime action is disabled by server projection.',
      },
    })
  }

  return action
}

const isGenerationAction = (actionKey) => [
  RUNTIME_ACTION_KEYS.GENERATE_SECTION,
  RUNTIME_ACTION_KEYS.REGENERATE_SECTION,
].includes(normalizeRuntimeActionToken(actionKey))

const DISCOVERY_BUILD_ACTIONS = new Set([
  RUNTIME_ACTION_KEYS.SAVE_DISCOVERY_INPUTS,
  RUNTIME_ACTION_KEYS.BUILD_EVIDENCE_PACK,
  RUNTIME_ACTION_KEYS.REFRESH_EVIDENCE_PACK,
])

const isDiscoveryAction = (actionKey) => [
  RUNTIME_ACTION_KEYS.SAVE_DISCOVERY_INPUTS,
  RUNTIME_ACTION_KEYS.BUILD_EVIDENCE_PACK,
  RUNTIME_ACTION_KEYS.REFRESH_EVIDENCE_PACK,
  RUNTIME_ACTION_KEYS.ACCEPT_EVIDENCE,
].includes(normalizeRuntimeActionToken(actionKey))

const getRuntimeActionGraphTrigger = (actionKey) => {
  const normalizedActionKey = normalizeRuntimeActionToken(actionKey)
  if (isGenerationAction(normalizedActionKey)) {
    return RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.SECTION_GENERATED
  }
  if (normalizedActionKey === RUNTIME_ACTION_KEYS.ACCEPT_EVIDENCE) {
    return RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EVIDENCE_ACCEPTED
  }
  if (DISCOVERY_BUILD_ACTIONS.has(normalizedActionKey)) {
    return RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.EVIDENCE_UPDATED
  }
  if (normalizedActionKey === RUNTIME_ACTION_KEYS.PUBLISH) {
    return RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.PUBLISH_COMPLETED
  }
  if (normalizedActionKey === RUNTIME_ACTION_KEYS.LOCK_RECORD) {
    return RUNTIME_INTELLIGENCE_GRAPH_BUILD_TRIGGERS.LOCK_COMPLETED
  }
  return ''
}

const rebuildRuntimeIntelligenceGraphForAction = ({
  actionKey,
  actorUserId,
  frameworkPackage,
  previousFrameworkState,
  resolvedTransition,
  runtimeInstance,
} = {}) => {
  const buildTrigger = getRuntimeActionGraphTrigger(actionKey)
  if (!buildTrigger) return resolvedTransition

  const nextGraph = buildRuntimeIntelligenceGraphForFrameworkState({
    actorUserId,
    buildTrigger,
    frameworkPackage,
    frameworkState: resolvedTransition.nextFrameworkState,
    runtimeInstance,
  })

  if (nextGraph.validation?.status !== 'VALID') {
    throw buildActionError({
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
    ...resolvedTransition,
    intelligenceGraphResult: buildRuntimeIntelligenceGraphAuditSummary({
      autoRebuilt: true,
      buildTrigger,
      nextGraph,
      previousGraph: previousFrameworkState?.intelligence_graph || {},
    }),
    nextFrameworkState: {
      ...(resolvedTransition.nextFrameworkState || {}),
      intelligence_graph: nextGraph,
    },
  }
}

const getRuntimeSectionStateKey = ({ runtimePath, sectionKey }) => {
  const normalizedRuntimePath = String(runtimePath || '').trim()
  const sectionRootPrefix = 'framework_state.sections.'

  if (normalizedRuntimePath.startsWith(sectionRootPrefix)) {
    const statePath = normalizedRuntimePath.slice(sectionRootPrefix.length).trim()
    if (statePath && !statePath.includes('.')) return statePath
  }

  return String(sectionKey || '').trim()
}

const resolveGenerationTargetSection = ({ frameworkPackage, payload }) => {
  const sectionKey = String(payload?.sectionKey || '').trim()
  const runtimePath = String(payload?.runtimePath || '').trim()
  const sections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const sectionByKey = sectionKey
    ? sections.find((candidate) => normalizeRuntimeSectionIdentity(candidate?.sectionKey)
      === normalizeRuntimeSectionIdentity(sectionKey))
    : null
  const sectionByPath = runtimePath
    ? sections.find((candidate) => String(candidate?.runtimePath || '').trim() === runtimePath)
    : null

  if (sectionKey && runtimePath && sectionByKey !== sectionByPath) {
    throw buildActionError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime generation sectionKey and runtimePath must target the same package section.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_TARGET_MISMATCH,
      details: {
        sectionKey,
        runtimePath,
      },
    })
  }

  const section = sectionByKey || sectionByPath

  if (!section) {
    throw buildActionError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Runtime generation action requires a package-bound section target.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        sectionKey,
        runtimePath,
      },
    })
  }

  return {
    section,
    sectionKey: String(section.sectionKey || '').trim(),
    runtimePath: String(section.runtimePath || '').trim(),
    stateSectionKey: getRuntimeSectionStateKey({
      runtimePath: section.runtimePath,
      sectionKey: section.sectionKey,
    }),
  }
}

const applyRuntimeSectionGeneration = async ({
  actionKey,
  actorUserId,
  frameworkPackage,
  payload,
  runtimeInstance,
}) => {
  const normalizedActionKey = normalizeRuntimeActionToken(actionKey)
  const actionedAt = new Date().toISOString()
  const previousFrameworkState = cloneRuntimeActionValue(runtimeInstance.framework_state || {})
  const nextFrameworkState = cloneRuntimeActionValue(previousFrameworkState)
  nextFrameworkState.sections = nextFrameworkState.sections || {}

  const target = resolveGenerationTargetSection({ frameworkPackage, payload })
  const sectionExecutionContract = await resolveSectionExecutionContract({
    frameworkPackage,
    section: target.section,
  })
  const previousRawSection = nextFrameworkState.sections[target.stateSectionKey]
  const discovery = buildDiscoveryProjection(nextFrameworkState)
  const generationEligibility = buildSectionGenerationEligibility({
    dependencySectionKeys: getDependencySectionKeys(target.section),
    discovery,
    frameworkState: nextFrameworkState,
    rawSectionValue: previousRawSection,
  })

  if (normalizedActionKey === RUNTIME_ACTION_KEYS.GENERATE_SECTION && generationEligibility.canGenerate !== true) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime section cannot be generated before Intelligence Hub evidence or section context exists.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        disabledReason: generationEligibility.reason,
        sectionKey: target.sectionKey,
        runtimePath: target.runtimePath,
      },
    })
  }

  const sectionObject = normalizeRuntimeSectionObject({
    value: previousRawSection,
    sectionKey: target.sectionKey,
    runtimePath: target.runtimePath,
    initializedAt: actionedAt,
  })
  const targetDependencySectionKeys = getDependencySectionKeys(target.section)
  const payloadAdditionalContext = typeof payload?.additionalContext === 'string'
    ? payload.additionalContext.trim()
    : ''
  const existingInput = getRuntimeSectionInput(sectionObject)
  const input = payloadAdditionalContext || existingInput
  const inputChanged = hashSectionInput(existingInput) !== hashSectionInput(input)
  const currentGenerated = getRuntimeSectionGenerated(sectionObject)
  const previousAccepted = getRuntimeSectionAccepted(sectionObject)
  const existingRevisions = getRuntimeSectionRevisions(sectionObject)
  const latestGeneratedRevision = getLatestRuntimeSectionRevisionValue(existingRevisions, 'generated')
  const archivedGenerated = latestGeneratedRevision?.generated || null
  const previousGenerated = hasRuntimeValue(currentGenerated)
    ? currentGenerated
    : normalizedActionKey === RUNTIME_ACTION_KEYS.REGENERATE_SECTION
      ? archivedGenerated
      : null
  let regenerationEligibility = null

  if (normalizedActionKey === RUNTIME_ACTION_KEYS.GENERATE_SECTION && !hasRuntimeValue(currentGenerated) && hasRuntimeValue(archivedGenerated)) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime section has archived generated content and must be regenerated instead of generated.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        disabledReason: 'Regenerate this section because previous generated content is archived for comparison.',
        sectionKey: target.sectionKey,
        runtimePath: target.runtimePath,
      },
    })
  }

  if (normalizedActionKey === RUNTIME_ACTION_KEYS.REGENERATE_SECTION && !hasRuntimeValue(previousGenerated)) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime section cannot be regenerated before generated content exists.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        sectionKey: target.sectionKey,
        runtimePath: target.runtimePath,
      },
    })
  }

  if (normalizedActionKey === RUNTIME_ACTION_KEYS.REGENERATE_SECTION && generationEligibility.canGenerate !== true) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime section cannot be regenerated before Intelligence Hub evidence is accepted.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        disabledReason: generationEligibility.reason,
        sectionKey: target.sectionKey,
        runtimePath: target.runtimePath,
      },
    })
  }

  if (normalizedActionKey === RUNTIME_ACTION_KEYS.REGENERATE_SECTION) {
    regenerationEligibility = buildRegenerationEligibility({
      dependencySectionKeys: targetDependencySectionKeys,
      frameworkPackage,
      frameworkState: nextFrameworkState,
      input,
      payload,
      previousGenerated,
      runtimeInstance,
      section: target.section,
      sectionObject,
    })

    if (regenerationEligibility.canRegenerate !== true) {
      throw buildActionError({
        status: 409,
        code: 'CONFLICT',
        message: 'Runtime section regeneration is blocked because no section context changed.',
        reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
        details: {
          actionKey: normalizedActionKey,
          disabledReason: 'Section regeneration is blocked because input, dependency, package, and style context are unchanged.',
          sectionKey: target.sectionKey,
          runtimePath: target.runtimePath,
          currentInputHash: regenerationEligibility.currentInputHash,
        },
      })
    }
  }

  const { generated, intelligence } = await buildReasonedGeneratedSection({
    actionKey: normalizedActionKey,
    actorUserId: toIdString(actorUserId),
    dependencySectionKeys: targetDependencySectionKeys,
    frameworkPackage,
    frameworkState: nextFrameworkState,
    input,
    runtimeInstance,
    section: target.section,
    sectionExecutionContract,
    generatedAt: actionedAt,
  })
  const validationResults = executeSectionValidationRules({
    candidate: generated,
    checkedAt: actionedAt,
    sectionExecutionContract,
  })
  if (validationResults.length > 0) {
    generated.validationResults = validationResults
  }
  const similarityResult = evaluateSectionInterpretationSimilarity({
    candidate: generated,
    frameworkPackage,
    frameworkState: nextFrameworkState,
    section: target.section,
    sectionLabel: sectionExecutionContract.sectionIdentity.label,
  })
  if (!similarityResult.passed) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime section generation was blocked because the business interpretation duplicates another section.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        sectionKey: target.sectionKey,
        runtimePath: target.runtimePath,
        similarityResult,
      },
    })
  }
  generated.similarityResult = similarityResult
  const hasGeneratedRevision = hasRuntimeValue(currentGenerated)
  const hasAcceptedRevision = hasRuntimeValue(previousAccepted)
  const revisions = hasGeneratedRevision || hasAcceptedRevision
    ? [
        ...existingRevisions,
        buildRuntimeSectionRevision({
          ...(hasGeneratedRevision ? { generated: currentGenerated } : {}),
          ...(hasAcceptedRevision ? { accepted: previousAccepted } : {}),
          reason: inputChanged ? 'SECTION_INPUT_CHANGED' : 'SECTION_GENERATION_REPLACED',
          revisionNumber: existingRevisions.length + 1,
          replacedAt: actionedAt,
        }),
      ]
    : existingRevisions
  const baseIntelligence = clearRuntimeSectionRegenerationIntelligence(sectionObject.intelligence)
  if (generated.sectionIntelligence) delete baseIntelligence.sectionIntelligence
  const baseLineage = clearRuntimeSectionRegenerationLineage(sectionObject.lineage)
  const baseState = clearRuntimeSectionRegenerationState(sectionObject.state)

  nextFrameworkState.sections[target.stateSectionKey] = {
    ...sectionObject,
    input,
    generated,
    accepted: null,
    intelligence: {
      ...baseIntelligence,
      ...intelligence,
      ...(hasAcceptedRevision ? {
        invalidation: {
          reason: inputChanged ? 'SECTION_INPUT_CHANGED' : 'SECTION_GENERATION_REPLACED',
          invalidatedAt: actionedAt,
          archivedRevisionNumber: revisions.length,
        },
      } : {}),
    },
    revisions,
    review: {
      ...(sectionObject.review || {}),
      status: 'PENDING_REVIEW',
      ...(hasAcceptedRevision ? {
        invalidatedAt: actionedAt,
        invalidationReason: inputChanged ? 'SECTION_INPUT_CHANGED' : 'SECTION_GENERATION_REPLACED',
      } : {}),
    },
    state: {
      ...baseState,
      status: intelligence.truthEligibility?.eligible === false
        ? RUNTIME_SECTION_STATES.INSUFFICIENT_EVIDENCE
        : normalizedActionKey === RUNTIME_ACTION_KEYS.REGENERATE_SECTION
          ? RUNTIME_SECTION_STATES.REGENERATED
          : RUNTIME_SECTION_STATES.GENERATED,
      generatedAt: actionedAt,
      lastActionKey: normalizedActionKey,
      revisionCount: revisions.length,
      inputHash: generated.inputHash,
      ...(hasAcceptedRevision ? {
        acceptedInvalidatedAt: actionedAt,
        acceptedInvalidationReason: inputChanged ? 'SECTION_INPUT_CHANGED' : 'SECTION_GENERATION_REPLACED',
      } : {}),
      updatedBy: toIdString(actorUserId),
    },
    lineage: {
      ...baseLineage,
      sectionKey: target.sectionKey,
      stateSectionKey: target.stateSectionKey,
      runtimePath: target.runtimePath,
      runtimeInstanceId: toIdString(runtimeInstance._id),
      runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
      packageId: toIdString(runtimeInstance.packageId),
      packageKey: runtimeInstance.packageKey,
      packageVersion: runtimeInstance.packageVersion,
      actionKey: normalizedActionKey,
      generatedAt: actionedAt,
      inputHash: generated.inputHash,
      evidenceHash: generated.evidenceHash,
      dependencyHash: generated.dependencyHash,
      boundedContextHash: generated.boundedContextHash,
      ...(validationResults.length > 0 ? {
        validationResultKeys: validationResults.map((result) =>
          `${result.key}@${result.componentVersion}`),
        validationResultHashes: validationResults.map((result) =>
          result.resultHash),
        validationCheckedAt: validationResults[0].checkedAt,
      } : {}),
    },
    dependencies: {
      ...(sectionObject.dependencies || {}),
      state: targetDependencySectionKeys.some((sectionKey) =>
        !(generationEligibility.satisfiedDependencySectionKeys || []).includes(sectionKey),
      ) ? 'MISSING_CONTEXT' : 'SATISFIED',
      requiredSectionKeys: targetDependencySectionKeys,
      satisfiedSectionKeys: Array.isArray(generationEligibility.satisfiedDependencySectionKeys)
        ? generationEligibility.satisfiedDependencySectionKeys
        : [],
      missingSectionKeys: targetDependencySectionKeys.filter((sectionKey) =>
        !(generationEligibility.satisfiedDependencySectionKeys || []).includes(sectionKey),
      ),
      missingAcceptedTruthSectionKeys: [],
      invalidatedSectionKeys: [],
      resolvedAt: actionedAt,
      resolvedByActionKey: normalizedActionKey,
    },
  }
  invalidateRuntimeSectionEvidence({
    frameworkState: nextFrameworkState,
    invalidatedAt: actionedAt,
    runtimePath: target.runtimePath,
  })

  return {
    actionedAt,
    generationResult: {
      sectionKey: target.sectionKey,
      stateSectionKey: target.stateSectionKey,
      runtimePath: target.runtimePath,
      generated,
      intelligence,
      previousGenerated: cloneSectionValue(previousGenerated),
      truthEligibility: intelligence.truthEligibility || null,
      tokenSafety: intelligence.tokenSafety || null,
      warnings: intelligence.truthEligibility?.eligible === false
        ? (intelligence.truthEligibility.messages || [])
        : [],
      regeneration: regenerationEligibility
        ? {
            forceRegenerateReason: regenerationEligibility.forceRegenerateReason,
            currentInputHash: regenerationEligibility.currentInputHash,
            currentEvidenceHash: regenerationEligibility.currentEvidenceHash,
            currentSectionEvidenceHash: regenerationEligibility.currentSectionEvidenceHash,
            currentDependencyHash: regenerationEligibility.currentDependencyHash,
            invalidatedDependencySectionKeys: regenerationEligibility.invalidatedDependencySectionKeys,
            previousInputHash: regenerationEligibility.previousInputHash,
            previousEvidenceHash: regenerationEligibility.previousEvidenceHash,
            previousSectionEvidenceHash: regenerationEligibility.previousSectionEvidenceHash,
            previousDependencyHash: regenerationEligibility.previousDependencyHash,
            reasons: regenerationEligibility.reasons,
          }
        : null,
      revisionCount: revisions.length,
    },
    nextExecutionStatus: runtimeInstance.executionStatus || 'IDLE',
    nextFrameworkState,
    previousFrameworkState,
    validationResult: null,
  }
}

const applyRuntimeDiscoveryAction = async ({
  actionKey,
  actorUserId,
  payload,
  runtimeInstance,
}) => {
  const normalizedActionKey = normalizeRuntimeActionToken(actionKey)
  const previousFrameworkState = cloneRuntimeActionValue(runtimeInstance.framework_state || {})
  const nextFrameworkState = cloneRuntimeActionValue(previousFrameworkState)
  const previousEvidencePack = cloneRuntimeActionValue(previousFrameworkState.evidence_pack || {})
  const actionedAt = new Date().toISOString()
  let nextEvidencePack = previousEvidencePack

  if (DISCOVERY_BUILD_ACTIONS.has(normalizedActionKey)) {
    nextEvidencePack = await buildDiscoveryEvidencePack({
      acquisitionProfile: payload?.acquisitionProfile,
      actorUserId,
      documentSources: payload?.documentSources,
      inputs: payload?.inputs || previousEvidencePack.inputs || {},
      previousEvidencePack,
      reason: normalizedActionKey,
      runtimeInstance,
    })
  }

  if (normalizedActionKey === RUNTIME_ACTION_KEYS.ACCEPT_EVIDENCE) {
    assertDiscoveryEvidenceAcceptable(previousEvidencePack)
    const acquisitionProfile = previousEvidencePack.acquisition?.profile || previousEvidencePack.acquisitionProfile
    const acceptedEvidenceObjects = acceptPendingDiscoveryEvidenceObjects({
      acceptedAt: actionedAt,
      actorUserId,
      evidenceObjects: normalizeDiscoveryEvidenceObjects({
        acquisitionProfile,
        createdAt: previousEvidencePack.refreshedAt || actionedAt,
        evidenceObjects: previousEvidencePack.evidenceObjects,
        inputs: previousEvidencePack.inputs,
        sources: previousEvidencePack.lineage?.sources || [],
      }),
    })
    const sourceRegistry = buildDiscoverySourceRegistry({
      capturedAt: previousEvidencePack.refreshedAt || actionedAt,
      evidenceObjects: acceptedEvidenceObjects,
      sourceRegistry: previousEvidencePack.sourceRegistry,
      sources: previousEvidencePack.lineage?.sources || [],
    })
    const reviewSummary = buildDiscoveryEvidenceReviewSummary(acceptedEvidenceObjects)
    const acceptedScopedViews = buildAcceptedDiscoveryScopedViews({
      acquisitionProfile,
      evidenceObjects: acceptedEvidenceObjects,
      inputHash: previousEvidencePack.evidence?.inputHash || '',
      previousScopedViews: previousEvidencePack.scoped_views || previousEvidencePack.scopedViews || {},
      refreshedAt: previousEvidencePack.refreshedAt || actionedAt,
    })
    const previousCoverage = previousEvidencePack.acquisition?.coverage || previousEvidencePack.evidence?.coverage || {}
    const hasCoverageSummary = isPlainRuntimeActionObject(previousCoverage) && Object.keys(previousCoverage).length > 0
    const acceptedCoverage = hasCoverageSummary
      ? buildAcceptedDiscoveryCoverageForAction({
          ...previousCoverage,
          sourceCount: sourceRegistry.length || previousCoverage.sourceCount,
          evidenceObjectCount: reviewSummary.evidenceObjectCount,
          rejectedEvidenceCount: reviewSummary.rejectedEvidenceCount,
        })
      : null
    const discoveryHealth = buildDiscoveryHealth({
      acquisitionProfile,
      coverage: {
        ...(acceptedCoverage || {}),
        confidence: previousEvidencePack.acquisition?.confidence || previousEvidencePack.evidence?.confidence,
      },
      evidenceObjects: acceptedEvidenceObjects,
      lastAcquisitionDate: previousEvidencePack.refreshedAt || actionedAt,
      sourceRegistry,
    })

    nextEvidencePack = {
      ...previousEvidencePack,
      inputComplete: true,
      evidenceReady: true,
      accepted: true,
      needsRefresh: false,
      acceptedAt: actionedAt,
      acceptedBy: toIdString(actorUserId),
      sourceRegistry,
      evidenceObjects: acceptedEvidenceObjects,
      discoveryHealth,
      scopedViews: acceptedScopedViews,
      scoped_views: acceptedScopedViews,
      ...(acceptedCoverage && isPlainRuntimeActionObject(previousEvidencePack.acquisition)
        ? {
            acquisition: {
              ...previousEvidencePack.acquisition,
              sourceRegistry,
              coverage: acceptedCoverage,
              discoveryHealth,
            },
          }
        : {}),
      evidence: isPlainRuntimeActionObject(previousEvidencePack.evidence)
        ? {
            ...previousEvidencePack.evidence,
            ...(acceptedCoverage ? { coverage: acceptedCoverage } : {}),
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
  }

  await assertRuntimeEvidencePackWritable({
    frameworkKey: runtimeInstance.frameworkKey,
    value: nextEvidencePack,
  })

  nextFrameworkState.evidence_pack = nextEvidencePack

  return {
    actionedAt,
    nextExecutionStatus: runtimeInstance.executionStatus || 'IDLE',
    nextFrameworkState,
    runtimeUpdate: {},
    validationResult: null,
    discoveryResult: {
      status: nextEvidencePack.state?.status || '',
      inputComplete: nextEvidencePack.inputComplete === true || nextEvidencePack.state?.inputComplete === true,
      evidenceReady: nextEvidencePack.evidenceReady === true || nextEvidencePack.state?.evidenceReady === true,
      accepted: nextEvidencePack.accepted === true || nextEvidencePack.state?.accepted === true,
      needsRefresh: nextEvidencePack.needsRefresh === true || nextEvidencePack.state?.needsRefresh === true,
      acquisitionProfile: nextEvidencePack.acquisition?.profile || nextEvidencePack.acquisitionProfile || '',
      inputCount: Object.keys(nextEvidencePack.inputs || {}).length,
      sourceCount: Array.isArray(nextEvidencePack.sourceRegistry)
        ? nextEvidencePack.sourceRegistry.length
        : (Array.isArray(nextEvidencePack.lineage?.sources) ? nextEvidencePack.lineage.sources.length : 0),
    },
  }
}

const buildActionAuditPayload = ({
  action,
  actionedAt,
  actorUserId,
  expectedUpdatedAt,
  nextExecutionStatus,
  nextFrameworkState,
  previousExecutionStatus,
  previousFrameworkState,
  runtimeInstance,
  updatedAtBefore,
  validationResult,
  generationResult,
  discoveryResult,
  intelligenceGraphResult,
  graphLifecycle,
  sourceRollover,
  nextRuntimeUpdate = {},
  previousRuntimeStatus,
  previousLockedAt,
}) => ({
  action: auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED,
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
    actionKey: normalizeRuntimeActionToken(action?.actionKey),
    governedAction: normalizeRuntimeActionToken(action?.governedAction || action?.actionKey),
    policyKey: action?.policyKey || '',
    expectedUpdatedAt,
    updatedAtBefore,
    updatedAtAfter: runtimeInstance.updatedAt instanceof Date
      ? runtimeInstance.updatedAt.toISOString()
      : runtimeInstance.updatedAt,
    runtimeType: runtimeInstance.runtimeType,
    frameworkKey: runtimeInstance.frameworkKey,
    packageKey: runtimeInstance.packageKey,
    packageVersion: runtimeInstance.packageVersion,
    executionStatus: {
      from: previousExecutionStatus,
      to: nextExecutionStatus,
    },
    runtimeStatus: {
      from: previousRuntimeStatus,
      to: nextRuntimeUpdate.status || runtimeInstance.status,
    },
    lock: {
      from: {
        lockedAt: previousLockedAt || null,
        state: previousFrameworkState?.lock || {},
      },
      to: {
        lockedAt: runtimeInstance.lockedAt || nextRuntimeUpdate.lockedAt || null,
        state: nextFrameworkState?.lock || {},
      },
    },
    publish: {
      from: previousFrameworkState?.publish || {},
      to: nextFrameworkState?.publish || {},
    },
    lifecycle: {
      from: previousFrameworkState?.lifecycle || {},
      to: nextFrameworkState?.lifecycle || {},
    },
    readiness: {
      from: previousFrameworkState?.readiness || {},
      to: nextFrameworkState?.readiness || {},
    },
    ...(validationResult ? {
      validation: {
        key: validationResult.key,
        status: validationResult.status,
        is_valid: validationResult.is_valid,
        missingRequiredSections: validationResult.missingRequiredSections,
      },
    } : {}),
    ...(generationResult ? {
      generation: {
        sectionKey: generationResult.sectionKey,
        stateSectionKey: generationResult.stateSectionKey,
        runtimePath: generationResult.runtimePath,
        revisionCount: generationResult.revisionCount,
        generatedAt: generationResult.generated?.generatedAt,
        inputHash: generationResult.generated?.inputHash,
        evidenceHash: generationResult.generated?.evidenceHash,
        dependencyHash: generationResult.generated?.dependencyHash,
        boundedContextHash: generationResult.generated?.boundedContextHash,
        sectionContractHash: generationResult.generated?.generator?.sectionContractHash,
        ...(Array.isArray(generationResult.generated?.validationResults)
          && generationResult.generated.validationResults.length > 0
          ? { validationResults: generationResult.generated.validationResults
            .map((result) => ({
              key: result.key,
              componentVersion: result.componentVersion,
              status: result.status,
              is_valid: result.is_valid === true,
              executorVersion: result.executorVersion,
              resultHash: result.resultHash,
            })) }
          : {}),
        similarityResult: generationResult.generated?.similarityResult
          ? {
              version: generationResult.generated.similarityResult.version,
              passed: generationResult.generated.similarityResult.passed === true,
              threshold: generationResult.generated.similarityResult.threshold,
              maximumScore: generationResult.generated.similarityResult.maximumScore,
              comparisonCount: generationResult.generated.similarityResult.comparisonCount,
              topMatchSectionKey: generationResult.generated.similarityResult.topMatchSectionKey,
            }
          : null,
        tokenClass: generationResult.tokenSafety?.tokenClass,
        truthEligibility: {
          eligible: generationResult.truthEligibility?.eligible === true,
          status: generationResult.truthEligibility?.status || '',
        },
        warningCount: Array.isArray(generationResult.warnings) ? generationResult.warnings.length : 0,
        previousGenerated: generationResult.previousGenerated ? true : false,
        regeneration: generationResult.regeneration || null,
      },
    } : {}),
    ...(discoveryResult ? {
      discovery: {
        status: discoveryResult.status,
        inputComplete: discoveryResult.inputComplete,
        evidenceReady: discoveryResult.evidenceReady,
        accepted: discoveryResult.accepted,
        needsRefresh: discoveryResult.needsRefresh,
        acquisitionProfile: discoveryResult.acquisitionProfile,
        inputCount: discoveryResult.inputCount,
        sourceCount: discoveryResult.sourceCount,
      },
    } : {}),
    ...(intelligenceGraphResult ? {
      intelligenceGraph: intelligenceGraphResult,
    } : {}),
    ...(graphLifecycle ? {
      runtimeStateGraph: {
        previousSnapshotId: graphLifecycle.previousSnapshotId,
        stateStatus: graphLifecycle.status,
      },
    } : {}),
    ...(sourceRollover ? {
      runtimeStateSource: {
        counts: sourceRollover.counts,
        sourceSetHash: sourceRollover.sourceSetHash,
      },
    } : {}),
    actionedAt,
  },
})

const logRuntimeActionExecuted = async ({
  action,
  actionedAt,
  actorUserId,
  auditRequest,
  expectedUpdatedAt,
  nextExecutionStatus,
  nextFrameworkState,
  previousExecutionStatus,
  previousFrameworkState,
  runtimeInstance,
  updatedAtBefore,
  validationResult,
  generationResult,
  discoveryResult,
  intelligenceGraphResult,
  graphLifecycle,
  sourceRollover,
  nextRuntimeUpdate,
  previousRuntimeStatus,
  previousLockedAt,
  session = null,
}) => {
  const auditPayload = buildActionAuditPayload({
    action,
    actionedAt,
    actorUserId,
    expectedUpdatedAt,
    nextExecutionStatus,
    nextFrameworkState,
    previousExecutionStatus,
    previousFrameworkState,
    runtimeInstance,
    updatedAtBefore,
    validationResult,
    generationResult,
    discoveryResult,
    intelligenceGraphResult,
    graphLifecycle,
    sourceRollover,
    nextRuntimeUpdate,
    previousRuntimeStatus,
    previousLockedAt,
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
    throw buildActionError({
      status: 500,
      code: 'RUNTIME_ACTION_AUDIT_FAILED',
      message: 'Runtime action audit could not be persisted.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED,
      details: {
        auditError: serializeErrorDetails(err),
      },
    })
  }
}

const logRuntimeActionRollbackFailure = async ({
  auditError,
  rollbackError = null,
  runtimeInstance,
  updatedRuntimeInstance,
}) => auditService.log({
  action: auditService.AUDIT_ACTIONS.RUNTIME_ACTION_EXECUTED,
  resourceType: auditService.RESOURCE_TYPES.RuntimeInstance,
  resourceId: runtimeInstance?._id,
  actorType: 'SYSTEM',
  systemActor: 'runtime-action-rollback',
  isSystemEvent: true,
  systemEventType: 'RUNTIME_ACTION_ROLLBACK_FAILED',
  eventCategory: 'RUNTIME',
  eventSeverity: 'CRITICAL',
  scope: {
    customerId: toIdString(runtimeInstance?.customerId),
    tenantId: toIdString(runtimeInstance?.tenantId),
    runtimeInstanceId: toIdString(runtimeInstance?._id),
    runtimeInstanceKey: runtimeInstance?.runtimeInstanceKey,
  },
  diff: {
    reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_AUDIT_PERSISTENCE_FAILED,
    auditError: serializeErrorDetails(auditError),
    ...(rollbackError ? { rollbackError: serializeErrorDetails(rollbackError) } : {}),
    attemptedRollbackUpdatedAt: updatedRuntimeInstance?.updatedAt instanceof Date
      ? updatedRuntimeInstance.updatedAt.toISOString()
      : updatedRuntimeInstance?.updatedAt,
  },
})

const atomicPersistRuntimeAction = async ({
  actorUserId,
  expectedUpdatedAt,
  expectedStateVersion,
  nextExecutionStatus,
  nextFrameworkState,
  nextStateVersion,
  nextRuntimeUpdate = {},
  runtimeInstance,
  session = null,
}) => {
  const expectedUpdatedAtDate = normalizeUpdatedAtDate(expectedUpdatedAt)
  if (!expectedUpdatedAtDate) {
    throw buildStaleActionError({ runtimeInstance, expectedUpdatedAt })
  }

  let canonicalStateVersion
  try {
    canonicalStateVersion = requireCanonicalRuntimeStateVersion(runtimeInstance)
  } catch (error) {
    throw buildActionError({
      status: error.status || 409,
      code: 'CONFLICT',
      message: error.message,
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_STATE_VERSION_REQUIRED,
      details: {
        ...(error.details || {}),
        expectedStateVersion: expectedStateVersion || null,
      },
    })
  }

  if (canonicalStateVersion !== expectedStateVersion || !nextStateVersion) {
    throw buildStaleActionError({ runtimeInstance, expectedUpdatedAt })
  }

  const updatedRuntimeInstance = await RuntimeInstance.findOneAndUpdate(
    {
      _id: runtimeInstance._id,
      updatedAt: expectedUpdatedAtDate,
      stateVersion: expectedStateVersion,
    },
    {
      $set: {
        framework_state: nextFrameworkState,
        executionStatus: nextExecutionStatus,
        updatedBy: actorUserId || runtimeInstance.updatedBy || null,
        ...nextRuntimeUpdate,
        stateVersion: nextStateVersion,
      },
    },
    {
      new: true,
      runValidators: true,
      ...(session ? { session } : {}),
    },
  )

  if (!updatedRuntimeInstance) {
    throw buildStaleActionError({ runtimeInstance, expectedUpdatedAt, currentUpdatedAt: null })
  }

  return updatedRuntimeInstance
}

const rollbackRuntimeAction = async ({
  previousExecutionStatus,
  previousFrameworkState,
  previousStateVersion,
  previousRuntimeStatus,
  previousLockedAt,
  previousLockedBy,
  previousLockedReason,
  previousUpdatedBy,
  runtimeInstance,
  nextStateVersion,
  updatedRuntimeInstance,
}) => {
  const rollbackUpdatedAt = normalizeUpdatedAtDate(updatedRuntimeInstance?.updatedAt)
  if (!rollbackUpdatedAt) return false

  const rolledBackRuntimeInstance = await RuntimeInstance.findOneAndUpdate(
    {
      _id: runtimeInstance._id,
      updatedAt: rollbackUpdatedAt,
      stateVersion: nextStateVersion || updatedRuntimeInstance?.stateVersion,
    },
    {
      $set: {
        framework_state: previousFrameworkState,
        stateVersion: previousStateVersion,
        executionStatus: previousExecutionStatus,
        status: previousRuntimeStatus,
        lockedAt: previousLockedAt || null,
        lockedBy: previousLockedBy || null,
        lockedReason: previousLockedReason || '',
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

const persistActionWithAudit = async ({
  action,
  actionedAt,
  actorUserId,
  auditRequest,
  expectedUpdatedAt,
  nextExecutionStatus,
  nextFrameworkState,
  nextRuntimeUpdate,
  previousExecutionStatus,
  previousFrameworkState,
  previousStateVersion,
  previousRuntimeStatus,
  previousLockedAt,
  previousLockedBy,
  previousLockedReason,
  previousUpdatedBy,
  runtimeInstance,
  updatedAtBefore,
  validationResult,
  generationResult,
  discoveryResult,
  intelligenceGraphResult,
  rebuiltIntelligenceGraph = null,
}) => {
  let nextStateVersion
  try {
    previousStateVersion = requireCanonicalRuntimeStateVersion(runtimeInstance)
    nextStateVersion = createNextRuntimeStateVersion(previousStateVersion)
  } catch (error) {
    throw buildActionError({
      status: error.status || 409,
      code: 'CONFLICT',
      message: error.message,
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_STATE_VERSION_REQUIRED,
      details: error.details || {},
    })
  }
  const stateMutationTimestamp = updatedAtBefore || new Date()

  if (mongoose.connection.readyState === 1) {
    const session = await mongoose.startSession()
    let updatedRuntimeInstance = null
    let graphLifecycle = null
    let sourceRollover = null
    try {
      await session.withTransaction(async () => {
        updatedRuntimeInstance = await atomicPersistRuntimeAction({
          actorUserId,
          expectedUpdatedAt,
          expectedStateVersion: previousStateVersion,
          nextExecutionStatus,
          nextFrameworkState,
          nextStateVersion,
          nextRuntimeUpdate,
          runtimeInstance,
          session,
        })
        // Match mutation persistence: hash the exact saved representation, not
        // pre-cast empty metadata that Mongoose may minimize during the update.
        const persisted = await RuntimeInstance.collection.findOne({
          _id: runtimeInstance._id,
          customerId: runtimeInstance.customerId,
          tenantId: runtimeInstance.tenantId,
          runtimeInstanceKey: runtimeInstance.runtimeInstanceKey,
          stateVersion: nextStateVersion,
        }, { session, projection: { framework_state: 1 } })
        if (!persisted?.framework_state || typeof persisted.framework_state !== 'object'
          || Array.isArray(persisted.framework_state)) {
          throw buildActionError({
            status: 409,
            code: 'CONFLICT',
            message: 'Saved runtime state could not be read for its V2 action source projection.',
            reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_STATE_VERSION_REQUIRED,
          })
        }
        sourceRollover = await stageRuntimeStateSourceRollover({
          runtimeInstance,
          expectedStateVersion: previousStateVersion,
          nextStateVersion,
          nextFrameworkState: persisted.framework_state,
          mutationTimestamp: stateMutationTimestamp,
          session,
        })
        graphLifecycle = await stageRuntimeStateGraphSourceMutation({
          runtimeInstance,
          expectedStateVersion: previousStateVersion,
          graphWillRebuild: Boolean(rebuiltIntelligenceGraph),
          session,
        })
        if (String(graphLifecycle.migrationReceiptId || '')
          !== String(sourceRollover.migrationReceiptId || '')) {
          throw buildActionError({
            status: 409,
            code: 'CONFLICT',
            message: 'Runtime V2 source and graph receipt lineage do not match.',
            reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_STATE_VERSION_REQUIRED,
          })
        }
        await logRuntimeActionExecuted({
          action,
          actionedAt,
          actorUserId,
          auditRequest,
          expectedUpdatedAt,
          nextExecutionStatus,
          nextFrameworkState,
          previousExecutionStatus,
          previousFrameworkState,
          previousRuntimeStatus,
          previousLockedAt,
          runtimeInstance: updatedRuntimeInstance,
          updatedAtBefore,
          validationResult,
          generationResult,
          discoveryResult,
          intelligenceGraphResult,
          graphLifecycle,
          sourceRollover,
          session,
        })
      })
    } finally {
      await session.endSession()
    }
    const finalized = await finalizeRuntimeStateGraphSourceMutation({
      actorUserId,
      graph: rebuiltIntelligenceGraph,
      migrationReceiptId: graphLifecycle?.migrationReceiptId,
      runtimeInstance: updatedRuntimeInstance,
    })
    return finalized.runtimeInstance
  }

  const updatedRuntimeInstance = await atomicPersistRuntimeAction({
    actorUserId,
    expectedUpdatedAt,
    expectedStateVersion: previousStateVersion,
    nextExecutionStatus,
    nextFrameworkState,
    nextStateVersion,
    nextRuntimeUpdate,
    runtimeInstance,
  })

  try {
    await logRuntimeActionExecuted({
      action,
      actionedAt,
      actorUserId,
      auditRequest,
      expectedUpdatedAt,
      nextExecutionStatus,
      nextFrameworkState,
      previousExecutionStatus,
      previousFrameworkState,
      previousRuntimeStatus,
      previousLockedAt,
      nextRuntimeUpdate,
      runtimeInstance: updatedRuntimeInstance,
      updatedAtBefore,
      validationResult,
      generationResult,
      discoveryResult,
      intelligenceGraphResult,
    })
  } catch (err) {
    try {
      const rollbackSucceeded = await rollbackRuntimeAction({
        previousExecutionStatus,
        previousFrameworkState,
        previousStateVersion,
        previousRuntimeStatus,
        previousLockedAt,
        previousLockedBy,
        previousLockedReason,
        previousUpdatedBy,
        runtimeInstance,
        nextStateVersion,
        updatedRuntimeInstance,
      })
      if (!rollbackSucceeded) {
        err.details = {
          ...(err.details || {}),
          rollbackFailed: true,
        }
        await logRuntimeActionRollbackFailure({
          auditError: err,
          runtimeInstance,
          updatedRuntimeInstance,
        })
      }
    } catch (rollbackErr) {
      err.details = {
        ...(err.details || {}),
        rollbackFailed: true,
        rollbackError: serializeErrorDetails(rollbackErr),
      }
      await logRuntimeActionRollbackFailure({
        auditError: err,
        rollbackError: rollbackErr,
        runtimeInstance,
        updatedRuntimeInstance,
      })
    }
    throw err
  }

  return updatedRuntimeInstance
}

export const executeRuntimeAction = async ({
  actionKey,
  actorUserId,
  auditRequest,
  payload,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const normalizedActionKey = normalizeRuntimeActionToken(actionKey)
  const expectedUpdatedAt = payload?.expectedUpdatedAt

  assertActionSupported(normalizedActionKey)

  const runtimeInstance = await resolveRuntimeInstanceDocument({ runtimeInstanceId })

  assertSupportedRuntimeType(runtimeInstance)

  const customerId = toIdString(runtimeInstance.customerId)
  const tenantId = toIdString(runtimeInstance.tenantId)

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
    feature: getFeatureForRuntimeType(runtimeInstance.runtimeType),
  })

  assertExpectedUpdatedAt({ runtimeInstance, expectedUpdatedAt })

  const renderer = await getRuntimeRenderer({ scopes, runtimeInstanceId })
  const action = resolveRendererAction({ renderer, actionKey: normalizedActionKey })
  const frameworkPackage = await FrameworkPackage.findById(runtimeInstance.packageId)
  if (!frameworkPackage) {
    throw buildActionError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Framework package not found.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.PACKAGE_NOT_FOUND,
      details: { packageId: toIdString(runtimeInstance.packageId) },
    })
  }

  const runtimeGate = getRuntimeActionStateGate({
    actionKey: normalizedActionKey,
    frameworkPackage,
    runtimeInstance,
    frameworkState: runtimeInstance.framework_state,
  })

  if (!runtimeGate.allowed) {
    throw buildActionError({
      status: 409,
      code: 'CONFLICT',
      message: 'Runtime action is not currently executable.',
      reason: RUNTIME_INSTANCE_ERROR_REASONS.RUNTIME_ACTION_NOT_AVAILABLE,
      details: {
        actionKey: normalizedActionKey,
        disabledReason: runtimeGate.reason,
      },
    })
  }

  const previousFrameworkState = cloneRuntimeActionValue(runtimeInstance.framework_state || {})
  const previousUpdatedBy = runtimeInstance.updatedBy
  const previousExecutionStatus = runtimeInstance.executionStatus
  const previousRuntimeStatus = runtimeInstance.status
  const previousLockedAt = runtimeInstance.lockedAt || null
  const previousLockedBy = runtimeInstance.lockedBy || null
  const previousLockedReason = runtimeInstance.lockedReason || ''
  const updatedAtBefore = runtimeInstance.updatedAt instanceof Date
    ? runtimeInstance.updatedAt.toISOString()
    : runtimeInstance.updatedAt
  const transition = buildRuntimeActionTransition({
    actionKey: normalizedActionKey,
    actorUserId,
    frameworkPackage,
    runtimeInstance,
  })
  let resolvedTransition = transition
  if (isGenerationAction(normalizedActionKey)) {
    resolvedTransition = await applyRuntimeSectionGeneration({
      actionKey: normalizedActionKey,
      actorUserId,
      frameworkPackage,
      payload,
      runtimeInstance,
    })
  } else if (isDiscoveryAction(normalizedActionKey)) {
    resolvedTransition = await applyRuntimeDiscoveryAction({
      actionKey: normalizedActionKey,
      actorUserId,
      payload,
      runtimeInstance,
    })
  }
  resolvedTransition = rebuildRuntimeIntelligenceGraphForAction({
    actionKey: normalizedActionKey,
    actorUserId,
    frameworkPackage,
    previousFrameworkState,
    resolvedTransition,
    runtimeInstance,
  })

  const updatedRuntimeInstance = await persistActionWithAudit({
    action,
    actionedAt: resolvedTransition.actionedAt,
    actorUserId,
    auditRequest,
    expectedUpdatedAt,
    nextExecutionStatus: resolvedTransition.nextExecutionStatus,
    nextFrameworkState: resolvedTransition.nextFrameworkState,
    nextRuntimeUpdate: resolvedTransition.runtimeUpdate || {},
    previousExecutionStatus,
    previousFrameworkState,
    previousRuntimeStatus,
    previousLockedAt,
    previousLockedBy,
    previousLockedReason,
    previousUpdatedBy,
    runtimeInstance,
    updatedAtBefore,
    validationResult: resolvedTransition.validationResult,
    generationResult: resolvedTransition.generationResult,
    discoveryResult: resolvedTransition.discoveryResult,
    intelligenceGraphResult: resolvedTransition.intelligenceGraphResult,
    rebuiltIntelligenceGraph: resolvedTransition.intelligenceGraphResult
      ? resolvedTransition.nextFrameworkState?.intelligence_graph
      : null,
  })

  return {
    runtimeInstance: {
      id: toIdString(updatedRuntimeInstance._id),
      runtimeInstanceKey: updatedRuntimeInstance.runtimeInstanceKey,
      runtimeType: updatedRuntimeInstance.runtimeType,
      status: updatedRuntimeInstance.status,
      executionStatus: updatedRuntimeInstance.executionStatus,
      lockedAt: updatedRuntimeInstance.lockedAt instanceof Date
        ? updatedRuntimeInstance.lockedAt.toISOString()
        : updatedRuntimeInstance.lockedAt || null,
      updatedAt: updatedRuntimeInstance.updatedAt instanceof Date
        ? updatedRuntimeInstance.updatedAt.toISOString()
        : updatedRuntimeInstance.updatedAt,
    },
    action: {
      actionKey: normalizedActionKey,
      governedAction: normalizeRuntimeActionToken(action.governedAction || action.actionKey),
      policyKey: action.policyKey || '',
      actionedAt: resolvedTransition.actionedAt,
    },
    state: {
      lifecycle: resolvedTransition.nextFrameworkState.lifecycle,
      readiness: resolvedTransition.nextFrameworkState.readiness,
      publish: resolvedTransition.nextFrameworkState.publish || {},
      lock: resolvedTransition.nextFrameworkState.lock || {},
      ...(resolvedTransition.validationResult ? { validation: resolvedTransition.validationResult } : {}),
      ...(resolvedTransition.generationResult ? { generation: {
        sectionKey: resolvedTransition.generationResult.sectionKey,
        stateSectionKey: resolvedTransition.generationResult.stateSectionKey,
        runtimePath: resolvedTransition.generationResult.runtimePath,
        revisionCount: resolvedTransition.generationResult.revisionCount,
        generated: resolvedTransition.generationResult.generated,
        intelligence: resolvedTransition.generationResult.intelligence,
        confidence: resolvedTransition.generationResult.intelligence?.displayProjection?.confidence || null,
        truthEligibility: resolvedTransition.generationResult.truthEligibility,
        warnings: resolvedTransition.generationResult.warnings || [],
      } } : {}),
      ...(resolvedTransition.discoveryResult ? { discovery: resolvedTransition.discoveryResult } : {}),
    },
  }
}

const runtimeActionExecutionService = {
  executeRuntimeAction,
}

export default runtimeActionExecutionService
