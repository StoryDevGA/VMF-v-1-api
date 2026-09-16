import { createHash, randomUUID } from 'node:crypto'
import mongoose from 'mongoose'

import {
  OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION,
  OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION,
  OUTCOME_KCP_ERROR_CODES,
  OUTCOME_KCP_OPERATIONS,
  OUTCOME_KCP_STATUSES,
  OUTCOME_QUALITY_STAGE_SEQUENCE,
  OUTCOME_QUALITY_STAGES,
} from '../constants/outcomeGovernedQuality.js'
import { KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION } from '../constants/knowledgeRuntime.js'
import { OUTCOME_STUDIO_REQUIRED_PACKS } from '../constants/runtimeOutcomeStudio.js'
import {
  OutcomeKnowledgeCompositionPlan,
  RuntimeInstance,
} from '../models/index.js'
import auditService from './auditService.js'
import {
  buildKnowledgePackRelationshipChecksum,
  normalizeKnowledgeAssetId,
  normalizeKnowledgePackRelationships,
} from './knowledgePackRelationshipContract.js'
import { resolveOutcomeStudioKnowledgePackBinding } from './outcomeKnowledgePackRegistryService.js'
import { resolveOutcomeStudioKnowledgeContext } from './outcomeStudioKnowledgeContextService.js'
import { assertRuntimePermission } from './runtimeInstanceService.js'
import { isSelectableResolverPack } from '../utils/knowledgePackPredicates.js'

const TRANSACTION_TOPOLOGIES = new Set(['ReplicaSetWithPrimary', 'Sharded'])
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const REQUEST_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/
const STABLE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?$/
const SECTION_ROOT_PATTERN = /^framework_state\.sections\.([a-z0-9](?:[a-z0-9_-]{0,138}[a-z0-9])?)$/
const LEGACY_SECTION_PATH_PATTERN = /^framework_state\.sections\.([a-z0-9](?:[a-z0-9_-]{0,138}[a-z0-9])?)(\.accepted)?$/
const OPERATIONAL_TIMESTAMP_FIELDS = new Set([
  'acceptanceTimestamp',
  'acceptedAt',
  'activatedAt',
  'boundAt',
  'capturedAt',
  'createdAt',
  'deprecatedAt',
  'disabledAt',
  'generatedAt',
  'lockedAt',
  'occurredAt',
  'publishedAt',
  'resolvedAt',
  'reviewedAt',
  'runtimeUpdatedAt',
  'sourceGeneratedAt',
  'supersededAt',
  'timestamp',
  'updatedAt',
  'uploadedAt',
  'validatedAt',
])

const toPlain = (value) => {
  if (!value) return value
  if (typeof value.toObject === 'function') return value.toObject()
  return value
}

const toId = (value) => value?.toString ? value.toString() : String(value || '')
const text = (value) => String(value ?? '').trim()
const lower = (value) => text(value).toLowerCase()
const upper = (value) => text(value).toUpperCase()
const toIso = (value) => value instanceof Date
  ? value.toISOString()
  : value
    ? new Date(value).toISOString()
    : ''

const canonicalize = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof mongoose.Types.ObjectId) return value.toString().toLowerCase()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (key !== '_id' && key !== '__v') result[key] = canonicalize(value[key])
      return result
    }, {})
  }
  return value
}

export const hashOutcomeKnowledgeCompositionValue = (value) => createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex')

const projectSemanticFingerprintValue = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof mongoose.Types.ObjectId) return value.toString().toLowerCase()
  if (Array.isArray(value)) return value.map(projectSemanticFingerprintValue)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (key !== '_id' && key !== '__v' && !OPERATIONAL_TIMESTAMP_FIELDS.has(key)) {
        result[key] = projectSemanticFingerprintValue(value[key])
      }
      return result
    }, {})
  }
  return value
}

export const hashOutcomeKnowledgeCompositionSemanticValue = (value) => createHash('sha256')
  .update(JSON.stringify(projectSemanticFingerprintValue(value)))
  .digest('hex')

const hashSemanticFingerprintValue = hashOutcomeKnowledgeCompositionSemanticValue

const appError = (status, code, message, details = {}) => {
  const error = new Error(message)
  error.status = status
  error.code = code
  error.details = { reason: code, ...details }
  return error
}

const invalid = (message, details) => appError(422, OUTCOME_KCP_ERROR_CODES.INPUT_INVALID, message, details)
const truthNotLocked = (details) => appError(409, OUTCOME_KCP_ERROR_CODES.SOURCE_TRUTH_NOT_LOCKED, 'Knowledge Composition Plan requires locked canonical runtime truth.', details)
const truthIncomplete = (details) => appError(409, OUTCOME_KCP_ERROR_CODES.SOURCE_TRUTH_INCOMPLETE, 'Knowledge Composition Plan source truth evidence is incomplete.', details)
const runtimeStale = (details) => appError(409, OUTCOME_KCP_ERROR_CODES.RUNTIME_STALE, 'Knowledge Composition Plan runtime evidence changed before persistence.', details)
const resolutionBlocked = (details) => appError(409, OUTCOME_KCP_ERROR_CODES.RESOLUTION_BLOCKED, 'Knowledge Composition Plan resolution is blocked.', details)
const resolutionInvalid = (details) => appError(409, OUTCOME_KCP_ERROR_CODES.RESOLUTION_INTEGRITY_INVALID, 'Knowledge Composition Plan resolution evidence is invalid.', details)
const fingerprintMismatch = (details) => appError(409, OUTCOME_KCP_ERROR_CODES.FINGERPRINT_MISMATCH, 'Knowledge Composition Plan fingerprint does not match the approved dry run.', details)
const versionConflict = (details) => appError(409, OUTCOME_KCP_ERROR_CODES.VERSION_CONFLICT, 'Knowledge Composition Plan version conflicts with the current runtime plan.', details)
const predecessorInvalid = (details) => appError(409, OUTCOME_KCP_ERROR_CODES.PREDECESSOR_INVALID, 'Knowledge Composition Plan re-resolution predecessor evidence is invalid.', details)
const identicalReResolution = (details) => appError(409, OUTCOME_KCP_ERROR_CODES.IDENTICAL_RE_RESOLUTION, 'Knowledge Composition Plan re-resolution did not change semantic composition.', details)
const transactionRequired = () => appError(503, OUTCOME_KCP_ERROR_CODES.TRANSACTION_REQUIRED, 'Knowledge Composition Plan persistence requires MongoDB transaction support.')
const auditFailed = () => appError(503, OUTCOME_KCP_ERROR_CODES.AUDIT_FAILED, 'Knowledge Composition Plan audit persistence failed.')
const persistenceFailed = () => appError(503, OUTCOME_KCP_ERROR_CODES.PERSISTENCE_FAILED, 'Knowledge Composition Plan persistence failed.')

const stageAssignmentsForPack = (pack = {}) => {
  switch (upper(pack.packType)) {
    case 'ARL':
      return [OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW]
    case 'RL':
      return [OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL]
    case 'OUTPUT_TYPE_DEFINITION':
    case 'OUTPUT_SCHEMA':
    case 'STYLE':
      return [OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING]
    case 'TRUTH_CERTIFICATION':
      return [
        OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
        OUTCOME_QUALITY_STAGES.CANDIDATE_DISPOSITION,
      ]
    default:
      return [OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE]
  }
}

const projectPack = (pack = {}) => {
  let knowledgeAssetId = ''
  let dependencyReferences = []
  let relationshipGovernanceError = text(pack.relationshipGovernanceError)
  try {
    knowledgeAssetId = normalizeKnowledgeAssetId(pack.knowledgeAssetId, { required: true })
    dependencyReferences = normalizeKnowledgePackRelationships(pack.dependencyReferences)
    if (!relationshipGovernanceError
      && upper(pack.relationshipContractVersion) !== KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION) {
      relationshipGovernanceError = 'RELATIONSHIP_CONTRACT_VERSION_MISSING'
    } else if (!relationshipGovernanceError
      && lower(pack.relationshipChecksum) !== buildKnowledgePackRelationshipChecksum(dependencyReferences)) {
      relationshipGovernanceError = 'RELATIONSHIP_CHECKSUM_MISMATCH'
    }
  } catch (error) {
    relationshipGovernanceError = error.message || 'RELATIONSHIP_METADATA_INVALID'
  }
  return {
    activationId: text(pack.activationId),
    packId: text(pack.packId),
    versionId: text(pack.versionId),
    knowledgeAssetId,
    packCategory: upper(pack.packCategory),
    purposeCategory: upper(pack.purposeCategory),
    knowledgeLayer: upper(pack.knowledgeLayer),
    capabilityKey: lower(pack.capabilityKey),
    packType: upper(pack.packType),
    packKey: lower(pack.packKey),
    label: text(pack.label),
    semanticVersion: text(pack.semanticVersion),
    schemaVersion: text(pack.schemaVersion),
    lifecycleStatus: upper(pack.status),
    scopeType: upper(pack.scopeType),
    scopeKey: text(pack.scopeKey),
    executionMode: upper(pack.executionMode),
    visibility: upper(pack.visibility),
    workspaceCompatibility: [...new Set((pack.workspaceCompatibility || []).map(upper).filter(Boolean))].sort(),
    contentHash: lower(pack.contentHash),
    relationshipContractVersion: upper(pack.relationshipContractVersion),
    relationshipChecksum: lower(pack.relationshipChecksum),
    relationshipGovernanceError,
    dependencyReferences: canonicalize(dependencyReferences),
    stageAssignments: stageAssignmentsForPack(pack),
  }
}

const assertSelectedPackIntegrity = (pack) => {
  const requiredText = [
    'activationId',
    'packId',
    'versionId',
    'knowledgeAssetId',
    'packType',
    'packKey',
    'packCategory',
    'purposeCategory',
    'knowledgeLayer',
    'semanticVersion',
    'schemaVersion',
    'scopeType',
    'scopeKey',
    'executionMode',
    'visibility',
    'relationshipContractVersion',
  ]
  const missing = requiredText.filter((field) => !text(pack[field]))
  if (missing.length
    || pack.lifecycleStatus !== 'ACTIVE'
    || !CONTENT_HASH_PATTERN.test(pack.contentHash)
    || !SHA256_PATTERN.test(pack.relationshipChecksum)
    || pack.relationshipGovernanceError
    || !Array.isArray(pack.dependencyReferences)
    || !Array.isArray(pack.workspaceCompatibility)
    || !pack.workspaceCompatibility.length
    || !pack.stageAssignments.length) {
    throw resolutionInvalid({ activationId: pack.activationId, missing })
  }
}

const candidateValues = (item = {}) => {
  if (Array.isArray(item.candidates)) return item.candidates
  if (Array.isArray(item.candidate)) return item.candidate
  if (item.candidate && typeof item.candidate === 'object') return [item.candidate]
  if (item && typeof item === 'object' && [
    'activationId',
    'packId',
    'versionId',
    'knowledgeAssetId',
    'packType',
    'packKey',
  ].some((field) => Object.prototype.hasOwnProperty.call(item, field))) return [item]
  return []
}

const buildConsideredPackEvidence = (binding = {}) => {
  const selectedSources = new Map()
  const selectedPacks = new Map()
  const projectedByActivation = new Map()
  let rawActivationOccurrenceCount = 0
  let repeatedIdenticalActivationCount = 0
  let conflictingActivationCount = 0
  const inventoryActivation = (pack, source) => {
    const projected = projectPack(pack)
    rawActivationOccurrenceCount += 1
    if (!projected.activationId) {
      throw resolutionInvalid({ source, unclassifiedCandidateCount: 1 })
    }
    const fingerprint = hashOutcomeKnowledgeCompositionValue(projected)
    const prior = projectedByActivation.get(projected.activationId)
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        conflictingActivationCount += 1
        throw resolutionInvalid({
          activationId: projected.activationId,
          firstSource: prior.source,
          conflictingSource: source,
          conflictingActivationCount,
        })
      }
      repeatedIdenticalActivationCount += 1
    } else {
      projectedByActivation.set(projected.activationId, { fingerprint, projected, source })
    }
    return projected
  }
  const registerSelected = (pack, source) => {
    const projected = inventoryActivation(pack, source)
    assertSelectedPackIntegrity(projected)
    const activationId = projected.activationId
    if (!selectedPacks.has(activationId)) selectedPacks.set(activationId, projected)
    if (!selectedSources.has(activationId)) selectedSources.set(activationId, new Set())
    selectedSources.get(activationId).add(source)
  }

  for (const pack of binding.mandatorySafeguards || []) {
    if (isSelectableResolverPack(pack)) registerSelected(pack, 'MANDATORY_SAFEGUARD')
  }
  for (const [layer, packs] of Object.entries(binding.selectedByLayer || {})) {
    for (const pack of packs || []) registerSelected(pack, `SELECTED_BY_LAYER:${upper(layer)}`)
  }

  const incomingRequired = new Set((binding.dependencyGraph?.edges || [])
    .filter((edge) => upper(edge.requirement) === 'REQUIRED')
    .map((edge) => text(edge.to))
    .filter(Boolean))
  const decisionByActivation = new Map()
  const decisionPriority = Object.freeze({
    EXCLUDED: 1,
    INCOMPATIBLE: 2,
    AMBIGUOUS: 3,
    BLOCKED: 4,
    SELECTED: 5,
  })
  const addDecision = ({ decision, projected, rationale = [], source = '' }) => {
    const prior = decisionByActivation.get(projected.activationId)
    if (prior) {
      if (prior.decision !== decision) {
        const stricterDecision = prior.decision === 'SELECTED' || decision === 'SELECTED'
          ? 'SELECTED'
          : decisionPriority[decision] > decisionPriority[prior.decision]
            ? decision
            : prior.decision
        prior.decision = stricterDecision
        if (stricterDecision !== 'SELECTED') prior.requirement = 'NOT_SELECTED'
      }
      prior.rationale = [...new Set([...prior.rationale, ...rationale].filter(Boolean))].sort()
      prior.sources = [...new Set([...prior.sources, source].filter(Boolean))].sort()
      return
    }
    decisionByActivation.set(projected.activationId, {
      decision,
      activationId: projected.activationId,
      requirement: decision === 'SELECTED'
        ? (selectedSources.get(projected.activationId)?.has('MANDATORY_SAFEGUARD')
          || incomingRequired.has(projected.activationId)
          || ['OUTPUT_TYPE_DEFINITION', 'OUTPUT_SCHEMA', 'STYLE'].includes(projected.packType)
          ? 'REQUIRED'
          : 'OPTIONAL_SELECTED')
        : 'NOT_SELECTED',
      rationale: [...new Set(rationale.filter(Boolean))].sort(),
      sources: source ? [source] : [],
      pack: projected,
    })
  }

  for (const [activationId, pack] of selectedPacks.entries()) {
    addDecision({
      decision: 'SELECTED',
      projected: pack,
      rationale: [...selectedSources.get(activationId)].sort(),
      source: 'RESOLVER_SELECTION',
    })
  }

  const registerSurface = (items, decision, source) => {
    for (const item of items || []) {
      const rationale = [
        text(item.reason),
        text(item.code),
        text(item.blockerReason),
        text(item.blockedReason),
      ].filter(Boolean)
      for (const pack of candidateValues(item)) {
        const projected = inventoryActivation(pack, source)
        addDecision({ decision, projected, rationale, source })
      }
    }
  }
  registerSurface(binding.excludedCandidates, 'EXCLUDED', 'EXCLUDED_CANDIDATE')
  registerSurface(binding.blockedPacks, 'BLOCKED', 'BLOCKED_PACK')
  registerSurface(binding.ambiguousCandidates, 'AMBIGUOUS', 'AMBIGUOUS_CANDIDATE')
  registerSurface(binding.incompatibleCandidates, 'INCOMPATIBLE', 'INCOMPATIBLE_CANDIDATE')

  const missingDecisions = (binding.missingDependencies || []).map((missing, index) => {
    const evidence = {
      selector: canonicalize(missing.selector || {}),
      requirement: upper(missing.requirement) || 'REQUIRED',
      reason: text(missing.reason),
      requiredBy: canonicalize(missing.requiredBy || {}),
      relationship: canonicalize(missing.relationship || {}),
    }
    return {
      decision: 'MISSING',
      decisionId: `missing-${hashOutcomeKnowledgeCompositionValue({ index, evidence }).slice(0, 24)}`,
      activationId: '',
      requirement: evidence.requirement,
      rationale: [evidence.reason].filter(Boolean),
      sources: ['MISSING_DEPENDENCY'],
      selector: evidence.selector,
      requiredBy: evidence.requiredBy,
      relationship: evidence.relationship,
      pack: null,
    }
  }).sort((left, right) => left.decisionId.localeCompare(right.decisionId))
  const activationDecisions = [...decisionByActivation.values()]
    .sort((left, right) => left.activationId.localeCompare(right.activationId))
  const decisions = [...activationDecisions, ...missingDecisions]
  const selected = activationDecisions.filter((decision) => decision.decision === 'SELECTED')
  if (!selected.length) throw resolutionInvalid({ selectedPackCount: 0 })
  return {
    selectedPacks: selected.map((decision) => ({
      ...decision.pack,
      requirement: decision.requirement,
      selectionSources: decision.rationale,
    })),
    consideredPacks: decisions,
    coverage: {
      rawActivationOccurrenceCount,
      exposedActivationCount: projectedByActivation.size,
      classifiedActivationCount: decisionByActivation.size,
      selectedActivationCount: selected.length,
      repeatedIdenticalActivationCount,
      conflictingActivationCount,
      duplicateOrConflictingActivationCount:
        repeatedIdenticalActivationCount + conflictingActivationCount,
      missingDecisionCount: missingDecisions.length,
      unclassifiedCandidateCount: 0,
    },
  }
}

export const getOutcomeAcceptedTruthIdentityMode = (lockedTruth = {}) => {
  const hasMarker = Object.prototype.hasOwnProperty.call(
    lockedTruth,
    'acceptedTruthIdentityContractVersion',
  )
  if (!hasMarker) return 'LEGACY_ALIGNED'
  if (text(lockedTruth.acceptedTruthIdentityContractVersion)
    !== OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION) {
    throw resolutionInvalid({ field: 'acceptedTruthIdentityContractVersion' })
  }
  return 'MARKED_V1'
}

export const resolveOutcomeAcceptedTruthSectionIdentity = ({ lockedTruth = {}, section = {} } = {}) => {
  const mode = getOutcomeAcceptedTruthIdentityMode(lockedTruth)
  const sectionKey = lower(section.sectionKey)
  const runtimePath = text(section.runtimePath)
  if (!STABLE_KEY_PATTERN.test(sectionKey)) {
    throw resolutionInvalid({ field: 'acceptedSections.sectionKey' })
  }
  if (mode === 'MARKED_V1') {
    const stateSectionKey = lower(section.stateSectionKey)
    const match = runtimePath.match(SECTION_ROOT_PATTERN)
    if (!STABLE_KEY_PATTERN.test(stateSectionKey)
      || !match
      || lower(match[1]) !== stateSectionKey) {
      throw resolutionInvalid({ field: 'acceptedSections.stateSectionIdentity', sectionKey })
    }
    return { mode, sectionKey, stateSectionKey, runtimePath }
  }
  if (Object.prototype.hasOwnProperty.call(section, 'stateSectionKey')) {
    throw resolutionInvalid({ field: 'acceptedSections.mixedIdentityShape', sectionKey })
  }
  const match = runtimePath.match(LEGACY_SECTION_PATH_PATTERN)
  const stateSectionKey = lower(match?.[1])
  if (!match || stateSectionKey !== sectionKey) {
    throw resolutionInvalid({ field: 'acceptedSections.legacyIdentity', sectionKey })
  }
  return { mode, sectionKey, stateSectionKey, runtimePath }
}

const buildLockedTruthManifest = (runtime = {}, { identityMode = 'MARKED_V1' } = {}) => {
  const lock = runtime.framework_state?.lock || {}
  const publish = runtime.framework_state?.publish || {}
  const sections = runtime.framework_state?.sections || {}
  if (upper(runtime.status) !== 'LOCKED'
    || lock.locked !== true
    || upper(lock.state) !== 'LOCKED'
    || lock.outputEligibility?.canonicalOutputEligible !== true) {
    throw truthNotLocked({ runtimeStatus: runtime.status, lockState: lock.state })
  }
  const requiredIds = {
    publishSnapshotId: text(lock.publish?.snapshotId || publish.snapshot?.snapshotId),
    publishSnapshotHash: lower(lock.publish?.snapshotHash || publish.snapshot?.snapshotHash),
    lockSnapshotId: text(lock.snapshot?.snapshotId),
    lockSnapshotHash: lower(lock.snapshot?.snapshotHash),
    replayAnchorId: text(lock.anchor?.replayAnchorId || lock.replayAnchor?.replayAnchorId),
    replayAnchorHash: lower(lock.anchor?.replayAnchorHash || lock.replayAnchor?.replayAnchorHash),
    dependencySnapshotId: text(lock.evidence?.dependencySnapshotId),
    dependencySnapshotHash: lower(lock.evidence?.dependencySnapshotHash),
  }
  const missingIds = Object.entries(requiredIds).filter(([, value]) => !value).map(([key]) => key)
  const marked = identityMode === 'MARKED_V1'
  const acceptedSections = Object.entries(sections).map(([outerStateSectionKey, section]) => {
    const accepted = section?.accepted || {}
    const stateSectionKey = lower(outerStateSectionKey)
    const sectionKey = marked ? lower(accepted.sectionKey) : stateSectionKey
    return {
      sectionKey,
      ...(marked ? { stateSectionKey } : {}),
      runtimePath: text(accepted.runtimePath),
      status: upper(section?.state?.status),
      truthHash: lower(accepted.truthHash),
      acceptedAt: toIso(accepted.acceptedAt),
      acceptedBy: toId(accepted.acceptedBy),
      sourceActionKey: upper(accepted.sourceActionKey),
      sourceGeneratedAt: toIso(accepted.sourceGeneratedAt),
    }
  }).sort((left, right) => (
    left.sectionKey.localeCompare(right.sectionKey)
    || text(left.stateSectionKey).localeCompare(text(right.stateSectionKey))
  ))
  const identityLockedTruth = marked
    ? { acceptedTruthIdentityContractVersion: OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION }
    : {}
  const invalidSections = acceptedSections.filter((section) => (
    section.status !== 'ACCEPTED'
    || !section.runtimePath
    || !CONTENT_HASH_PATTERN.test(section.truthHash)
    || !section.acceptedAt
    || !section.acceptedBy
    || (() => {
      try {
        resolveOutcomeAcceptedTruthSectionIdentity({ lockedTruth: identityLockedTruth, section })
        return false
      } catch {
        return true
      }
    })()
    || (!marked && lower(sections[section.sectionKey]?.accepted?.sectionKey) !== section.sectionKey)
  )).map((section) => section.sectionKey || section.stateSectionKey)
  const duplicateSectionKeys = acceptedSections.length
    !== new Set(acceptedSections.map((section) => section.sectionKey)).size
  const duplicateStateSectionKeys = marked && acceptedSections.length
    !== new Set(acceptedSections.map((section) => section.stateSectionKey)).size
  if (missingIds.length || !acceptedSections.length || invalidSections.length
    || duplicateSectionKeys || duplicateStateSectionKeys) {
    throw truthIncomplete({
      missingIds,
      invalidSections,
      acceptedSectionCount: acceptedSections.length,
      duplicateSectionKeys,
      duplicateStateSectionKeys,
    })
  }
  return {
    ...identityLockedTruth,
    runtimeUpdatedAt: toIso(runtime.updatedAt),
    lockedAt: toIso(lock.lockedAt),
    lockedBy: toId(lock.lockedBy),
    ...requiredIds,
    acceptedSections,
  }
}

const buildConsumerIntent = (consumerIntent = {}, binding = {}) => {
  const normalized = {
    outcome: text(consumerIntent.outcome),
    decisionPurpose: text(consumerIntent.decisionPurpose),
    consumer: text(consumerIntent.consumer),
    audience: [...new Set((consumerIntent.audience || []).map(text).filter(Boolean))],
    requestedOutputTypeKey: lower(
      consumerIntent.requestedOutputTypeKey
      || binding.resolution?.request?.requestedOutputTypeKey,
    ),
    format: text(consumerIntent.format),
    channel: text(consumerIntent.channel),
    requirements: [...new Set((consumerIntent.requirements || []).map(text).filter(Boolean))],
    unresolvedGaps: [...new Set((consumerIntent.unresolvedGaps || []).map(text).filter(Boolean))],
  }
  if (!normalized.outcome
    || !normalized.decisionPurpose
    || !normalized.consumer
    || !normalized.audience.length
    || !normalized.requestedOutputTypeKey
    || !normalized.format) {
    throw invalid('Knowledge Composition Plan consumer intent is incomplete.')
  }
  return normalized
}

const projectContext = (context = {}) => ({
  contractVersion: text(context.contractVersion),
  contextId: text(context.contextId),
  status: upper(context.status),
  available: context.available === true,
  blockerReason: text(context.blockerReason),
  requestedOutputTypeKey: lower(context.requestedOutputTypeKey),
  outputType: canonicalize(context.outputType || {}),
  outputSchema: canonicalize(context.outputSchema || {}),
  style: canonicalize(context.style || {}),
  renderer: canonicalize(context.renderer || {}),
  warnings: canonicalize(Array.isArray(context.warnings) ? context.warnings : []),
  lineage: canonicalize(context.lineage || {}),
})

const projectResolution = (binding = {}) => ({
  status: upper(binding.status),
  mode: text(binding.mode),
  policyKey: text(binding.policyKey),
  policyVersion: text(binding.policyVersion),
  request: canonicalize(binding.resolution?.request || {}),
  scopeCandidates: canonicalize(binding.resolution?.scopeCandidates || []),
  dependencyGraph: canonicalize(binding.dependencyGraph || {}),
  lineage: canonicalize(binding.lineage || {}),
  missingDependencies: canonicalize(binding.missingDependencies || []),
  relationshipFailures: canonicalize(binding.relationshipFailures || []),
  ambiguousCandidates: canonicalize(binding.ambiguousCandidates || []),
  incompatibleCandidates: canonicalize(binding.incompatibleCandidates || []),
  blockedPacks: canonicalize(binding.blockedPacks || []),
  warnings: canonicalize(binding.warnings || []),
})

const hasRequiredGap = (resolution) => (
  ![OUTCOME_KCP_STATUSES.READY, OUTCOME_KCP_STATUSES.READY_WITH_GAPS].includes(resolution.status)
  || resolution.relationshipFailures.length > 0
  || resolution.ambiguousCandidates.length > 0
  || resolution.incompatibleCandidates.length > 0
  || (resolution.dependencyGraph.cycles || []).length > 0
  || (resolution.dependencyGraph.depthOverflows || []).length > 0
  || resolution.missingDependencies.some((gap) => upper(gap.requirement) !== 'OPTIONAL')
)

const mandatoryPackKeys = () => OUTCOME_STUDIO_REQUIRED_PACKS.map((pack) => lower(pack.packKey)).sort()

export const buildOutcomeKnowledgeCompositionPlanCandidate = ({
  runtime,
  binding,
  context,
  consumerIntent,
  requestScope,
  requestAssociation,
} = {}) => {
  if (!runtime || !binding || !context) throw invalid('Knowledge Composition Plan inputs are incomplete.')
  assertRequestScope(requestScope, runtime)
  const lockedTruth = buildLockedTruthManifest(runtime)
  const intent = buildConsumerIntent(consumerIntent, binding)
  const packEvidence = buildConsideredPackEvidence(binding)
  const selectedMandatoryKeys = (binding.mandatorySafeguards || []).map((pack) => lower(pack.packKey)).sort()
  if (JSON.stringify(selectedMandatoryKeys) !== JSON.stringify(mandatoryPackKeys())) {
    throw resolutionInvalid({ expectedMandatoryKeys: mandatoryPackKeys(), selectedMandatoryKeys })
  }
  const resolution = projectResolution(binding)
  const governedContext = projectContext(context)
  if (requestScope) {
    // Mixed payload persistence minimizes empty objects. Represent absent optional
    // style explicitly so the saved payload retains its approved fingerprint.
    if (!Object.keys(governedContext.style).length) governedContext.style = null
    // Resolver contextId includes observation time. Request confirmation must bind
    // semantic evidence, not a new clock sample; legacy fingerprints stay intact.
    const { contextId: _observationId, ...semanticContext } = governedContext
    governedContext.contextId = hashSemanticFingerprintValue(semanticContext)
  }
  const requiredGap = hasRequiredGap(resolution)
    || governedContext.status !== 'READY'
    || governedContext.available !== true
    || Boolean(governedContext.blockerReason)
  const optionalGapCount = resolution.missingDependencies
    .filter((gap) => upper(gap.requirement) === 'OPTIONAL').length
    + resolution.warnings.length
    + governedContext.warnings.length
    + intent.unresolvedGaps.length
  const status = requiredGap
    ? OUTCOME_KCP_STATUSES.BLOCKED
    : optionalGapCount > 0
      ? OUTCOME_KCP_STATUSES.READY_WITH_GAPS
      : OUTCOME_KCP_STATUSES.READY
  const stagePlan = OUTCOME_QUALITY_STAGE_SEQUENCE.map((stageKey, index) => ({
    order: index + 1,
    stageKey,
    assignedActivationIds: packEvidence.selectedPacks
      .filter((pack) => pack.stageAssignments.includes(stageKey))
      .map((pack) => pack.activationId)
      .sort(),
  }))
  const resolutionFingerprint = hashSemanticFingerprintValue({
    resolution,
    selectedPacks: packEvidence.selectedPacks,
    consideredPacks: packEvidence.consideredPacks,
  })
  const contextFingerprint = hashSemanticFingerprintValue(governedContext)
  const payload = {
    ...(requestScope ? { requestId: requestScope.requestId } : {}),
    ...(requestScope && requestAssociation ? { requestAssociation: canonicalize(requestAssociation) } : {}),
    ...(requestScope && runtime.planningEvidence ? { planningEvidence: canonicalize(runtime.planningEvidence) } : {}),
    contractVersion: OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION,
    status,
    runtime: {
      tenantId: toId(runtime.tenantId),
      customerId: toId(runtime.customerId),
      runtimeInstanceId: toId(runtime._id || runtime.id),
      runtimeInstanceKey: lower(runtime.runtimeInstanceKey),
      runtimeType: upper(runtime.runtimeType),
      frameworkKey: upper(runtime.frameworkKey),
      packageKey: text(runtime.packageKey),
      packageVersion: text(runtime.packageVersion),
    },
    lockedTruth,
    consumerIntent: intent,
    resolution: {
      ...resolution,
      resolutionFingerprint,
      selectedPacks: packEvidence.selectedPacks,
      consideredPacks: packEvidence.consideredPacks,
      consideredPackCoverage: packEvidence.coverage,
    },
    governedContext: { ...governedContext, contextFingerprint },
    stagePlan,
    optionalGapCount,
  }
  return {
    status,
    planFingerprint: hashSemanticFingerprintValue(payload),
    resolutionFingerprint,
    contextFingerprint,
    selectedPackCount: packEvidence.selectedPacks.length,
    consideredPackCount: packEvidence.consideredPacks.length,
    gapCount: intent.unresolvedGaps.length
      + resolution.warnings.length
      + governedContext.warnings.length
      + resolution.missingDependencies.length
      + resolution.relationshipFailures.length
      + resolution.ambiguousCandidates.length
      + resolution.incompatibleCandidates.length,
    payload,
  }
}

export const assertOutcomeKnowledgeCompositionPlanIntegrity = (value) => {
  const plan = toPlain(value)
  const payload = plan?.payload
  if (!plan || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw resolutionInvalid({ field: 'payload' })
  }
  const hasRequest = Object.prototype.hasOwnProperty.call(plan, 'requestId')
  if (hasRequest !== Object.prototype.hasOwnProperty.call(payload, 'requestId')
    || (hasRequest && (!REQUEST_ID_PATTERN.test(plan.requestId) || plan.requestId !== payload.requestId))) {
    throw resolutionInvalid({ field: 'requestId' })
  }
  if (plan.contractVersion !== OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION
    || payload.contractVersion !== OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION
    || ![OUTCOME_KCP_STATUSES.READY, OUTCOME_KCP_STATUSES.READY_WITH_GAPS].includes(plan.status)
    || payload.status !== plan.status) throw resolutionInvalid({ field: 'contractOrStatus' })
  if (!plan._id && !plan.id) throw resolutionInvalid({ field: 'recordId' })
  if (!text(plan.planId)
    || !Number.isInteger(Number(plan.planVersion))
    || Number(plan.planVersion) < 1
    || !SHA256_PATTERN.test(lower(plan.planFingerprint))
    || !SHA256_PATTERN.test(lower(plan.resolutionFingerprint))
    || !SHA256_PATTERN.test(lower(plan.contextFingerprint))) {
    throw resolutionInvalid({ field: 'identityOrFingerprint' })
  }
  if (hashSemanticFingerprintValue(payload) !== lower(plan.planFingerprint)) {
    throw fingerprintMismatch({ field: 'planFingerprint' })
  }

  const runtime = payload.runtime || {}
  const mirrors = [
    [toId(plan.tenantId), toId(runtime.tenantId), 'tenantId'],
    [toId(plan.customerId), toId(runtime.customerId), 'customerId'],
    [toId(plan.runtimeInstanceId), toId(runtime.runtimeInstanceId), 'runtimeInstanceId'],
    [lower(plan.runtimeInstanceKey), lower(runtime.runtimeInstanceKey), 'runtimeInstanceKey'],
    [upper(plan.runtimeType), upper(runtime.runtimeType), 'runtimeType'],
    [upper(plan.frameworkKey), upper(runtime.frameworkKey), 'frameworkKey'],
    [text(plan.packageKey), text(runtime.packageKey), 'packageKey'],
    [text(plan.packageVersion), text(runtime.packageVersion), 'packageVersion'],
    [lower(plan.requestedOutputTypeKey), lower(payload.consumerIntent?.requestedOutputTypeKey), 'requestedOutputTypeKey'],
    [text(plan.publishSnapshotId), text(payload.lockedTruth?.publishSnapshotId), 'publishSnapshotId'],
    [text(plan.lockSnapshotId), text(payload.lockedTruth?.lockSnapshotId), 'lockSnapshotId'],
    [text(plan.replayAnchorId), text(payload.lockedTruth?.replayAnchorId), 'replayAnchorId'],
    [text(plan.dependencySnapshotId), text(payload.lockedTruth?.dependencySnapshotId), 'dependencySnapshotId'],
  ]
  const mirrorMismatch = mirrors.find(([left, right]) => !left || left !== right)
  if (mirrorMismatch) throw resolutionInvalid({ field: mirrorMismatch[2] })

  const acceptedSections = Array.isArray(payload.lockedTruth?.acceptedSections)
    ? payload.lockedTruth.acceptedSections
    : []
  let acceptedIdentities = []
  try {
    acceptedIdentities = acceptedSections.map((section) => (
      resolveOutcomeAcceptedTruthSectionIdentity({ lockedTruth: payload.lockedTruth, section })
    ))
  } catch {
    throw resolutionInvalid({ field: 'acceptedSections' })
  }
  if (acceptedSections.length < 1
    || new Set(acceptedIdentities.map((identity) => identity.sectionKey)).size !== acceptedSections.length
    || new Set(acceptedIdentities.map((identity) => identity.stateSectionKey)).size !== acceptedSections.length
    || acceptedSections.some((section) => !CONTENT_HASH_PATTERN.test(lower(section?.truthHash)))) {
    throw resolutionInvalid({ field: 'acceptedSections' })
  }

  const persistedResolution = payload.resolution || {}
  const {
    resolutionFingerprint: nestedResolutionFingerprint,
    selectedPacks = [],
    consideredPacks = [],
    consideredPackCoverage: _coverage,
    ...resolution
  } = persistedResolution
  if (!Array.isArray(selectedPacks)
    || !Array.isArray(consideredPacks)
    || selectedPacks.length < 1
    || selectedPacks.length !== Number(plan.selectedPackCount)
    || consideredPacks.length !== Number(plan.consideredPackCount)
    || new Set(selectedPacks.map((pack) => text(pack?.activationId))).size !== selectedPacks.length
    || new Set(consideredPacks.map((pack) => text(pack?.activationId))).size !== consideredPacks.length) {
    throw resolutionInvalid({ field: 'packCountsOrIdentities' })
  }
  const computedResolutionFingerprint = hashSemanticFingerprintValue({
    resolution,
    selectedPacks,
    consideredPacks,
  })
  if (computedResolutionFingerprint !== lower(plan.resolutionFingerprint)
    || lower(nestedResolutionFingerprint) !== lower(plan.resolutionFingerprint)) {
    throw fingerprintMismatch({ field: 'resolutionFingerprint' })
  }

  const { contextFingerprint: nestedContextFingerprint, ...governedContext } = payload.governedContext || {}
  const computedContextFingerprint = hashSemanticFingerprintValue(governedContext)
  if (computedContextFingerprint !== lower(plan.contextFingerprint)
    || lower(nestedContextFingerprint) !== lower(plan.contextFingerprint)) {
    throw fingerprintMismatch({ field: 'contextFingerprint' })
  }

  const expectedGapCount = (Array.isArray(payload.consumerIntent?.unresolvedGaps)
    ? payload.consumerIntent.unresolvedGaps.length
    : 0)
    + (Array.isArray(persistedResolution.warnings) ? persistedResolution.warnings.length : 0)
    + (Array.isArray(payload.governedContext?.warnings) ? payload.governedContext.warnings.length : 0)
    + (Array.isArray(persistedResolution.missingDependencies) ? persistedResolution.missingDependencies.length : 0)
    + (Array.isArray(persistedResolution.relationshipFailures) ? persistedResolution.relationshipFailures.length : 0)
    + (Array.isArray(persistedResolution.ambiguousCandidates) ? persistedResolution.ambiguousCandidates.length : 0)
    + (Array.isArray(persistedResolution.incompatibleCandidates) ? persistedResolution.incompatibleCandidates.length : 0)
  if (expectedGapCount !== Number(plan.gapCount)) throw resolutionInvalid({ field: 'gapCount' })
  const expectedOptionalGapCount = (Array.isArray(payload.consumerIntent?.unresolvedGaps)
    ? payload.consumerIntent.unresolvedGaps.length
    : 0)
    + (Array.isArray(persistedResolution.missingDependencies)
      ? persistedResolution.missingDependencies.filter((gap) => upper(gap?.requirement) === 'OPTIONAL').length
      : 0)
    + (Array.isArray(persistedResolution.warnings) ? persistedResolution.warnings.length : 0)
    + (Array.isArray(payload.governedContext?.warnings) ? payload.governedContext.warnings.length : 0)
  if (expectedOptionalGapCount !== Number(payload.optionalGapCount)) {
    throw resolutionInvalid({ field: 'optionalGapCount' })
  }

  const stagePlan = Array.isArray(payload.stagePlan) ? payload.stagePlan : []
  if (stagePlan.length !== OUTCOME_QUALITY_STAGE_SEQUENCE.length) {
    throw resolutionInvalid({ field: 'stagePlan' })
  }
  for (const [index, stageKey] of OUTCOME_QUALITY_STAGE_SEQUENCE.entries()) {
    const stage = stagePlan[index]
    const expectedActivations = selectedPacks
      .filter((pack) => Array.isArray(pack.stageAssignments) && pack.stageAssignments.includes(stageKey))
      .map((pack) => text(pack.activationId))
      .sort()
    const assignedActivations = Array.isArray(stage?.assignedActivationIds)
      ? stage.assignedActivationIds.map(text).sort()
      : []
    if (stage?.stageKey !== stageKey
      || Number(stage?.order) !== index + 1
      || JSON.stringify(assignedActivations) !== JSON.stringify(expectedActivations)) {
      throw resolutionInvalid({ field: `stagePlan.${stageKey}` })
    }
  }
  return {
    ...canonicalize(plan),
    id: toId(plan._id || plan.id),
  }
}

export const assertOutcomeKnowledgeCompositionPlanMatchesRuntime = (planValue, runtimeValue) => {
  const plan = assertOutcomeKnowledgeCompositionPlanIntegrity(planValue)
  const runtime = toPlain(runtimeValue)
  if (!runtime
    || toId(runtime._id || runtime.id) !== toId(plan.runtimeInstanceId)
    || toId(runtime.tenantId) !== toId(plan.tenantId)
    || toId(runtime.customerId) !== toId(plan.customerId)
    || lower(runtime.runtimeInstanceKey) !== lower(plan.runtimeInstanceKey)
    || upper(runtime.runtimeType) !== upper(plan.runtimeType)
    || upper(runtime.frameworkKey) !== upper(plan.frameworkKey)
    || text(runtime.packageKey) !== text(plan.packageKey)
    || text(runtime.packageVersion) !== text(plan.packageVersion)) {
    throw runtimeStale({ field: 'runtimeScope' })
  }
  const identityMode = getOutcomeAcceptedTruthIdentityMode(plan.payload.lockedTruth)
  const currentLockedTruth = buildLockedTruthManifest(runtime, { identityMode })
  if (toIso(runtime.updatedAt) !== text(plan.payload.lockedTruth?.runtimeUpdatedAt)
    || hashSemanticFingerprintValue(currentLockedTruth)
    !== hashSemanticFingerprintValue(plan.payload.lockedTruth)) {
    throw runtimeStale({ field: 'lockedTruthEvidence' })
  }
  return plan
}

const readRuntime = async ({ model, runtimeInstanceId, session = null }) => {
  let query = model.findById(runtimeInstanceId)
  if (session && typeof query.session === 'function') query = query.session(session)
  return typeof query.lean === 'function' ? query.lean() : query
}

// Internal orchestration boundary, not a request-body contract. Runtime permissions
// are always checked independently; knowing a request UUID grants no authority.
const assertRequestScope = (scope, runtime) => {
  if (scope === undefined) return
  if (!scope || typeof scope !== 'object' || !REQUEST_ID_PATTERN.test(scope.requestId)
    || Object.keys(scope).sort().join(',') !== 'customerId,requestId,runtimeInstanceId,tenantId'
    || ['tenantId', 'customerId', 'runtimeInstanceId'].some((key) => !mongoose.isValidObjectId(scope[key]))
    || toId(scope.runtimeInstanceId) !== toId(runtime._id || runtime.id)
    || toId(scope.tenantId) !== toId(runtime.tenantId)
    || toId(scope.customerId) !== toId(runtime.customerId)) {
    throw invalid('Knowledge Composition Plan request scope is invalid.')
  }
}

export const assertLegacyOutcomeKnowledgeCompositionPlan = (value) => {
  const plan = toPlain(value)
  if (plan && (Object.prototype.hasOwnProperty.call(plan, 'requestId')
    || Object.prototype.hasOwnProperty.call(plan.payload || {}, 'requestId'))) {
    throw resolutionBlocked({ field: 'requestId', executionBlocked: true })
  }
  return assertOutcomeKnowledgeCompositionPlanIntegrity(value)
}

const assertKcpIndexes = async (model, requestScoped) => {
  let indexes
  try { indexes = await model.collection.listIndexes().toArray() } catch {
    throw appError(503, OUTCOME_KCP_ERROR_CODES.PERSISTENCE_FAILED, 'KCP request indexes are unavailable.', { field: 'requestIndexes' })
  }
  const key = (index) => JSON.stringify(Object.entries(index.key || {}))
  const required = JSON.stringify([['runtimeInstanceId', 1], ['requestId', 1], ['planVersion', 1]])
  const old = JSON.stringify([['runtimeInstanceId', 1], ['planVersion', 1]])
  const fullUnique = (index) => index.unique === true && !index.partialFilterExpression
    && !index.sparse && !index.hidden && !index.collation
  const hasNew = indexes.some((index) => key(index) === required && fullUnique(index))
  const hasOld = indexes.some((index) => key(index) === old && fullUnique(index))
  if (requestScoped
    ? !hasNew || indexes.some((index) => index.name === 'uniq_outcome_kcp_runtime_version' || key(index) === old)
    : !hasNew && !hasOld) {
    throw appError(503, OUTCOME_KCP_ERROR_CODES.PERSISTENCE_FAILED, 'KCP request indexes require a separately governed migration.', { field: 'requestIndexes' })
  }
}

export const assertOutcomeKcpRequestIndexes = (model = OutcomeKnowledgeCompositionPlan) => assertKcpIndexes(model, true)
export const assertOutcomeKcpLegacyIndexes = (model = OutcomeKnowledgeCompositionPlan) => assertKcpIndexes(model, false)

export const buildOutcomeKnowledgeCompositionPlanForRuntime = async ({
  actorUserId,
  scopes,
  runtimeInstanceId,
  expectedRuntimeUpdatedAt,
  consumerIntent,
  requestScope,
  requestAssociation,
  session = null,
  deps = {},
} = {}) => {
  const runtimeModel = deps.RuntimeInstance || RuntimeInstance
  const resolveBinding = deps.resolveBinding || resolveOutcomeStudioKnowledgePackBinding
  const resolveContext = deps.resolveContext || resolveOutcomeStudioKnowledgeContext
  const assertPermission = deps.assertRuntimePermission || assertRuntimePermission
  const runtime = requestScope && deps.readKcpRuntimeEvidence
    ? await deps.readKcpRuntimeEvidence({ runtimeInstanceId, scopes, session })
    : await readRuntime({ model: runtimeModel, runtimeInstanceId, session })
  if (!runtime) throw appError(404, OUTCOME_KCP_ERROR_CODES.INPUT_INVALID, 'Knowledge Composition Plan runtime was not found.')
  await assertPermission({
    actorUserId,
    scopes,
    customerId: runtime.customerId,
    tenantId: runtime.tenantId,
    permission: requestScope && upper(runtime.runtimeType) === 'DEAL_ANALYSIS' ? 'DEAL_VIEW' : 'VMF_VIEW',
  })
  assertRequestScope(requestScope, runtime)
  if (!expectedRuntimeUpdatedAt || toIso(runtime.updatedAt) !== toIso(expectedRuntimeUpdatedAt)) {
    throw runtimeStale({ expectedRuntimeUpdatedAt, actualRuntimeUpdatedAt: toIso(runtime.updatedAt) })
  }
  if (requestScope && deps.readKcpRuntimeEvidence && !runtime.planningEvidence) {
    throw runtimeStale({ field: 'planningEvidence' })
  }
  const query = {
    tenantId: runtime.tenantId,
    customerId: runtime.customerId,
    runtimeInstanceId: runtime._id,
    runtimeInstanceKey: runtime.runtimeInstanceKey,
    runtimeType: runtime.runtimeType,
    frameworkKey: runtime.frameworkKey,
    packageKey: runtime.packageKey,
    packageVersion: runtime.packageVersion,
    workspaceType: 'OUTCOME',
    requestedOutputTypeKey: lower(consumerIntent?.requestedOutputTypeKey),
  }
  const [{ binding }, contextResult] = await Promise.all([
    resolveBinding({ query }),
    resolveContext({ query }),
  ])
  return buildOutcomeKnowledgeCompositionPlanCandidate({
    runtime,
    binding,
    context: contextResult?.context,
    consumerIntent,
    requestScope,
    requestAssociation,
  })
}

const currentTopologyType = (mongooseClient) => {
  try {
    return mongooseClient.connection.getClient()?.topology?.description?.type || ''
  } catch {
    return ''
  }
}

export const assertOutcomeKnowledgeCompositionPlanTransactionSupport = (mongooseClient = mongoose) => {
  if (mongooseClient.connection.readyState !== 1
    || !TRANSACTION_TOPOLOGIES.has(currentTopologyType(mongooseClient))) throw transactionRequired()
}

const readLatestPlan = async ({ model, runtimeInstanceId, scope = {}, session }) => {
  let query = model.findOne({ runtimeInstanceId, requestId: { $exists: false }, ...scope }).sort({ planVersion: -1 })
  if (session && typeof query.session === 'function') query = query.session(session)
  return query
}

const serializePlan = (value) => {
  const plan = toPlain(value)
  if (!plan) return null
  return {
    id: toId(plan._id || plan.id),
    ...(plan.requestId !== undefined ? { requestId: plan.requestId } : {}),
    planId: plan.planId,
    planVersion: plan.planVersion,
    contractVersion: plan.contractVersion,
    operation: plan.operation,
    status: plan.status,
    tenantId: toId(plan.tenantId),
    customerId: toId(plan.customerId),
    runtimeInstanceId: toId(plan.runtimeInstanceId),
    runtimeInstanceKey: plan.runtimeInstanceKey,
    runtimeType: plan.runtimeType,
    frameworkKey: plan.frameworkKey,
    packageKey: plan.packageKey,
    packageVersion: plan.packageVersion,
    requestedOutputTypeKey: plan.requestedOutputTypeKey,
    sourcePlanId: plan.sourcePlanId || '',
    sourcePlanFingerprint: plan.sourcePlanFingerprint || '',
    reResolutionReason: plan.reResolutionReason || '',
    publishSnapshotId: plan.publishSnapshotId,
    lockSnapshotId: plan.lockSnapshotId,
    replayAnchorId: plan.replayAnchorId,
    dependencySnapshotId: plan.dependencySnapshotId,
    planFingerprint: plan.planFingerprint,
    resolutionFingerprint: plan.resolutionFingerprint,
    contextFingerprint: plan.contextFingerprint,
    selectedPackCount: plan.selectedPackCount,
    consideredPackCount: plan.consideredPackCount,
    gapCount: plan.gapCount,
    payload: canonicalize(plan.payload),
    createdBy: toId(plan.createdBy),
    createdAt: toIso(plan.createdAt),
  }
}

const auditPlanCreation = async ({ audit, session, plan, actorUserId }) => {
  try {
    const result = await audit.log({
      actorUserId,
      action: audit.AUDIT_ACTIONS.OUTCOME_KNOWLEDGE_COMPOSITION_PLAN_CREATED,
      resourceType: audit.RESOURCE_TYPES.OutcomeKnowledgeCompositionPlan,
      resourceId: plan._id,
      scope: {
        tenantId: plan.tenantId,
        customerId: plan.customerId,
        runtimeInstanceId: plan.runtimeInstanceId,
        runtimeInstanceKey: plan.runtimeInstanceKey,
      },
      diff: {
        ...(plan.requestId !== undefined ? { requestId: plan.requestId } : {}),
        operation: plan.operation,
        planId: plan.planId,
        planVersion: plan.planVersion,
        status: plan.status,
        planFingerprint: plan.planFingerprint,
        sourcePlanId: plan.sourcePlanId || '',
        sourcePlanFingerprint: plan.sourcePlanFingerprint || '',
        reResolutionReason: plan.reResolutionReason || '',
        publishSnapshotId: plan.publishSnapshotId,
        lockSnapshotId: plan.lockSnapshotId,
        replayAnchorId: plan.replayAnchorId,
        selectedPackCount: plan.selectedPackCount,
        consideredPackCount: plan.consideredPackCount,
        gapCount: plan.gapCount,
      },
    }, { session, throwOnError: true })
    if (!result) throw new Error('KCP audit returned no record.')
  } catch {
    throw auditFailed()
  }
}

const isWriteConflict = (error) => error?.code === 11000
  || error?.code === 112
  || error?.codeName === 'WriteConflict'
  || /E11000|WriteConflict|write conflict/i.test(error?.message || '')

const authorizeRequestPlan = async ({ actorUserId, scopes, runtimeInstanceId, requestScope, deps, permission }) => {
  if (!mongoose.isValidObjectId(actorUserId) || !mongoose.isValidObjectId(runtimeInstanceId) || !requestScope) {
    throw invalid('Knowledge Composition Plan request identity is incomplete.')
  }
  const runtime = deps.readRuntimeControl
    ? await deps.readRuntimeControl({ runtimeInstanceId, scopes })
    : await readRuntime({ model: deps.RuntimeInstance || RuntimeInstance, runtimeInstanceId })
  if (!runtime) throw appError(404, OUTCOME_KCP_ERROR_CODES.INPUT_INVALID, 'Knowledge Composition Plan runtime was not found.')
  await (deps.assertRuntimePermission || assertRuntimePermission)({
    actorUserId, scopes, customerId: runtime.customerId, tenantId: runtime.tenantId,
    permission: upper(runtime.runtimeType) === 'DEAL_ANALYSIS' ? permission.replace('VMF_', 'DEAL_') : permission,
  })
  assertRequestScope(requestScope, runtime)
  return {
    tenantId: runtime.tenantId, customerId: runtime.customerId,
    runtimeInstanceId: runtime._id || runtime.id, requestId: requestScope.requestId,
  }
}

const requestEvidenceResult = (plan, latest, idempotent) => ({
  plan: serializePlan(assertOutcomeKnowledgeCompositionPlanIntegrity(plan)),
  idempotent,
  currentness: {
    latestInRequest: text(plan.planId) === text(latest?.planId),
    evidenceStatus: 'NOT_REVALIDATED',
    current: false,
  },
  execution: { status: 'BLOCKED', canExecute: false, reason: 'REQUEST_EXECUTION_NOT_ENABLED' },
})

// Retrieval returns immutable evidence, never an execution/currentness grant.
export const getOutcomeRequestKnowledgeCompositionPlan = async ({
  actorUserId, scopes, runtimeInstanceId, requestScope, planId, deps = {},
} = {}) => {
  if (!text(planId)) throw invalid('Knowledge Composition Plan identity is required.')
  const scope = await authorizeRequestPlan({ actorUserId, scopes, runtimeInstanceId, requestScope, deps, permission: 'VMF_VIEW' })
  const model = deps.OutcomeKnowledgeCompositionPlan || OutcomeKnowledgeCompositionPlan
  const plan = toPlain(await model.findOne({ ...scope, planId: text(planId) }))
  if (!plan) throw appError(404, OUTCOME_KCP_ERROR_CODES.INPUT_INVALID, 'Knowledge Composition Plan was not found in this request.')
  const latest = toPlain(await readLatestPlan({ model, runtimeInstanceId, scope }))
  return requestEvidenceResult(plan, latest, false)
}

const readExactRequestRetry = async ({ model, scope, operation, expectedVersion, expectedPlanFingerprint,
  sourcePlanId, sourcePlanFingerprint, reResolutionReason, consumerIntent, session }) => {
  let query = model.findOne({
    ...scope, operation, planVersion: expectedVersion + 1, planFingerprint: lower(expectedPlanFingerprint),
    sourcePlanId: text(sourcePlanId), sourcePlanFingerprint: lower(sourcePlanFingerprint),
    reResolutionReason: text(reResolutionReason),
  })
  if (session && typeof query.session === 'function') query = query.session(session)
  const plan = toPlain(await query)
  if (!plan) return null
  assertOutcomeKnowledgeCompositionPlanIntegrity(plan)
  if (hashOutcomeKnowledgeCompositionValue(buildConsumerIntent(consumerIntent))
    !== hashOutcomeKnowledgeCompositionValue(plan.payload.consumerIntent)) throw fingerprintMismatch({ field: 'consumerIntent' })
  return plan
}

export const createOutcomeKnowledgeCompositionPlan = async ({
  runtimeInstanceId,
  expectedRuntimeUpdatedAt,
  consumerIntent,
  actorUserId,
  scopes,
  requestScope,
  requestAssociation,
  expectedPlanFingerprint,
  expectedCurrentPlanVersion = 0,
  operation = OUTCOME_KCP_OPERATIONS.INITIAL,
  sourcePlanId = '',
  sourcePlanFingerprint = '',
  reResolutionReason = '',
  deps = {},
} = {}) => {
  if (!mongoose.isValidObjectId(actorUserId)) throw invalid('Knowledge Composition Plan actor identity is invalid.')
  if (!SHA256_PATTERN.test(lower(expectedPlanFingerprint))) throw invalid('Knowledge Composition Plan expected fingerprint is invalid.')
  const normalizedOperation = upper(operation)
  if (!Object.values(OUTCOME_KCP_OPERATIONS).includes(normalizedOperation)) throw invalid('Knowledge Composition Plan operation is invalid.')
  const expectedVersion = Number(expectedCurrentPlanVersion)
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw invalid('Knowledge Composition Plan expected current version is invalid.')

  const mongooseClient = deps.mongoose || mongoose
  const planModel = deps.OutcomeKnowledgeCompositionPlan || OutcomeKnowledgeCompositionPlan
  const runtimeModel = deps.RuntimeInstance || RuntimeInstance
  let scope = {}
  let retryArgs
  if (requestScope !== undefined) {
    scope = await authorizeRequestPlan({ actorUserId, scopes, runtimeInstanceId, requestScope, deps, permission: 'VMF_UPDATE' })
    // No defaults from output bindings for request intent, including output type.
    buildConsumerIntent(consumerIntent)
    if (normalizedOperation === OUTCOME_KCP_OPERATIONS.INITIAL
      && (expectedVersion !== 0 || sourcePlanId || sourcePlanFingerprint || reResolutionReason)) throw predecessorInvalid()
    if (normalizedOperation === OUTCOME_KCP_OPERATIONS.RE_RESOLUTION
      && (expectedVersion < 1 || !text(sourcePlanId) || !SHA256_PATTERN.test(lower(sourcePlanFingerprint)) || !text(reResolutionReason))) throw predecessorInvalid()
    retryArgs = { model: planModel, scope, operation: normalizedOperation, expectedVersion, expectedPlanFingerprint,
      sourcePlanId, sourcePlanFingerprint, reResolutionReason, consumerIntent }
    const retry = await readExactRequestRetry(retryArgs)
    if (retry) return requestEvidenceResult(retry, toPlain(await readLatestPlan({ model: planModel, runtimeInstanceId, scope })), true)
    await assertOutcomeKcpRequestIndexes(planModel)
  }

  const initialCandidate = await buildOutcomeKnowledgeCompositionPlanForRuntime({
    actorUserId, scopes, requestScope, requestAssociation,
    runtimeInstanceId,
    expectedRuntimeUpdatedAt,
    consumerIntent,
    deps,
  })
  if (initialCandidate.status === OUTCOME_KCP_STATUSES.BLOCKED) {
    throw resolutionBlocked({ planFingerprint: initialCandidate.planFingerprint })
  }
  if (initialCandidate.planFingerprint !== lower(expectedPlanFingerprint)) {
    throw fingerprintMismatch({ expectedPlanFingerprint, actualPlanFingerprint: initialCandidate.planFingerprint })
  }
  if (!requestScope) await assertOutcomeKcpLegacyIndexes(planModel)

  const audit = deps.auditService || auditService
  const assertTransactionSupport = deps.assertTransactionSupport
    || assertOutcomeKnowledgeCompositionPlanTransactionSupport
  assertTransactionSupport(mongooseClient)

  let session
  let created = null
  let idempotentPlan = null
  try {
    session = await mongooseClient.startSession()
    if (!session || typeof session.withTransaction !== 'function' || typeof session.endSession !== 'function') {
      throw transactionRequired()
    }
    await session.withTransaction(async () => {
      // withTransaction may rerun after a write conflict. Do not retain a prior attempt's result.
      created = null
      idempotentPlan = null
      if (requestScope) {
        await assertOutcomeKcpRequestIndexes(planModel)
        const retry = await readExactRequestRetry({ ...retryArgs, session })
        if (retry) { idempotentPlan = retry; return }
      }
      const candidate = await buildOutcomeKnowledgeCompositionPlanForRuntime({
        actorUserId, scopes, requestScope, requestAssociation, session,
        runtimeInstanceId,
        expectedRuntimeUpdatedAt,
        consumerIntent,
        deps,
      })
      if (candidate.status === OUTCOME_KCP_STATUSES.BLOCKED) throw resolutionBlocked()
      if (candidate.planFingerprint !== initialCandidate.planFingerprint
        || candidate.planFingerprint !== lower(expectedPlanFingerprint)) {
        throw fingerprintMismatch({
          expectedPlanFingerprint,
          initialPlanFingerprint: initialCandidate.planFingerprint,
          actualPlanFingerprint: candidate.planFingerprint,
        })
      }

      const lockedRuntime = requestScope && deps.readKcpRuntimeEvidence
        ? await deps.readKcpRuntimeEvidence({ runtimeInstanceId, scopes, session })
        : await readRuntime({ model: runtimeModel, runtimeInstanceId, session })
      if (!lockedRuntime || toIso(lockedRuntime.updatedAt) !== toIso(expectedRuntimeUpdatedAt)) {
        throw runtimeStale({ expectedRuntimeUpdatedAt, actualRuntimeUpdatedAt: toIso(lockedRuntime?.updatedAt) })
      }
      if (requestScope && deps.readKcpRuntimeEvidence
        && (!lockedRuntime.planningEvidence || !candidate.payload.planningEvidence
          || hashSemanticFingerprintValue(lockedRuntime.planningEvidence) !== hashSemanticFingerprintValue(candidate.payload.planningEvidence)
          || hashSemanticFingerprintValue(buildLockedTruthManifest(lockedRuntime)) !== hashSemanticFingerprintValue(candidate.payload.lockedTruth))) {
        throw runtimeStale({ field: 'planningEvidence' })
      }
      const latest = await readLatestPlan({ model: planModel, runtimeInstanceId, scope, session })
      const latestPlain = toPlain(latest)
      if (latestPlain
        && !requestScope
        && normalizedOperation === OUTCOME_KCP_OPERATIONS.INITIAL
        && latestPlain.planFingerprint === candidate.planFingerprint) {
        idempotentPlan = latestPlain
        return
      }
      if (!requestScope) await assertOutcomeKcpLegacyIndexes(planModel)
      const currentVersion = Number(latestPlain?.planVersion || 0)
      if (currentVersion !== expectedVersion) {
        throw versionConflict({ expectedCurrentPlanVersion: expectedVersion, actualCurrentPlanVersion: currentVersion })
      }

      if (normalizedOperation === OUTCOME_KCP_OPERATIONS.INITIAL) {
        if (latestPlain || sourcePlanId || sourcePlanFingerprint || reResolutionReason) {
          throw versionConflict({ expectedCurrentPlanVersion: 0, actualCurrentPlanVersion: currentVersion })
        }
      } else {
        if (!latestPlain
          || latestPlain.planId !== text(sourcePlanId)
          || latestPlain.planFingerprint !== lower(sourcePlanFingerprint)
          || !text(reResolutionReason)) {
          throw predecessorInvalid({ currentPlanId: latestPlain?.planId || '', currentPlanVersion: currentVersion })
        }
        if (latestPlain.planFingerprint === candidate.planFingerprint) {
          throw identicalReResolution({ planId: latestPlain.planId, planVersion: currentVersion })
        }
      }

      const runtimePayload = candidate.payload.runtime
      const truth = candidate.payload.lockedTruth
      created = new planModel({
        ...(requestScope ? { requestId: requestScope.requestId } : {}),
        planId: `outcome_kcp_${randomUUID()}`,
        planVersion: currentVersion + 1,
        contractVersion: OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION,
        operation: normalizedOperation,
        status: candidate.status,
        tenantId: runtimePayload.tenantId,
        customerId: runtimePayload.customerId,
        runtimeInstanceId: runtimePayload.runtimeInstanceId,
        runtimeInstanceKey: runtimePayload.runtimeInstanceKey,
        runtimeType: runtimePayload.runtimeType,
        frameworkKey: runtimePayload.frameworkKey,
        packageKey: runtimePayload.packageKey,
        packageVersion: runtimePayload.packageVersion,
        requestedOutputTypeKey: candidate.payload.consumerIntent.requestedOutputTypeKey,
        sourcePlanId: normalizedOperation === OUTCOME_KCP_OPERATIONS.RE_RESOLUTION ? text(sourcePlanId) : '',
        sourcePlanFingerprint: normalizedOperation === OUTCOME_KCP_OPERATIONS.RE_RESOLUTION ? lower(sourcePlanFingerprint) : '',
        reResolutionReason: normalizedOperation === OUTCOME_KCP_OPERATIONS.RE_RESOLUTION ? text(reResolutionReason) : '',
        publishSnapshotId: truth.publishSnapshotId,
        lockSnapshotId: truth.lockSnapshotId,
        replayAnchorId: truth.replayAnchorId,
        dependencySnapshotId: truth.dependencySnapshotId,
        planFingerprint: candidate.planFingerprint,
        resolutionFingerprint: candidate.resolutionFingerprint,
        contextFingerprint: candidate.contextFingerprint,
        selectedPackCount: candidate.selectedPackCount,
        consideredPackCount: candidate.consideredPackCount,
        gapCount: candidate.gapCount,
        payload: candidate.payload,
        createdBy: actorUserId,
      })
      await created.save({ session })
      await auditPlanCreation({ audit, session, plan: created, actorUserId })
    })
    if (requestScope) return requestEvidenceResult(toPlain(idempotentPlan || created),
      toPlain(await readLatestPlan({ model: planModel, runtimeInstanceId, scope })), Boolean(idempotentPlan))
    return idempotentPlan
      ? { plan: serializePlan(idempotentPlan), idempotent: true }
      : { plan: serializePlan(created), idempotent: false }
  } catch (error) {
    if (Object.values(OUTCOME_KCP_ERROR_CODES).includes(error?.code)) throw error
    if (isWriteConflict(error)) {
      // A concurrent exact operation may already have committed. Never retry a
      // different operation or advance its predecessor automatically.
      if (retryArgs) {
        const retry = await readExactRequestRetry(retryArgs)
        if (retry) return requestEvidenceResult(retry, toPlain(await readLatestPlan({ model: planModel, runtimeInstanceId, scope })), true)
      }
      throw versionConflict()
    }
    throw persistenceFailed()
  } finally {
    if (typeof session?.endSession === 'function') await session.endSession()
  }
}

export default {
  hashOutcomeKnowledgeCompositionValue,
  buildOutcomeKnowledgeCompositionPlanCandidate,
  buildOutcomeKnowledgeCompositionPlanForRuntime,
  assertOutcomeKnowledgeCompositionPlanTransactionSupport,
  createOutcomeKnowledgeCompositionPlan,
}
