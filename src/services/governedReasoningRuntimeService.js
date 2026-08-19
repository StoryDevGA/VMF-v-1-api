import { randomUUID, createHash } from 'node:crypto'
import mongoose from 'mongoose'
import {
  FrameworkPackage,
  GovernedReasoningExecution,
  GovernedRuntimeArtifact,
  RuntimeInstance,
} from '../models/index.js'
import { RUNTIME_TYPES } from '../models/RuntimeInstance.js'
import {
  GRR_ARTIFACT_STATUSES,
  GRR_CONTRACT_VERSION,
  GRR_EXECUTION_STATUSES,
  GRR_PROVIDER_MODES,
  GRR_RUNTIME_STATE_WRITE_STATUSES,
} from '../constants/governedReasoningRuntime.js'
import {
  KNOWLEDGE_PACK_BOUNDARIES,
  KNOWLEDGE_PACK_EXECUTION_MODES,
  resolveKnowledgePackBoundary,
  resolveKnowledgePackReceiptType,
} from '../constants/knowledgeRuntime.js'
import {
  OUTCOME_STUDIO_READINESS_POLICY_VERSIONS,
  OUTCOME_STUDIO_REFERENCE_FAMILIES,
} from '../constants/outcomeStudioReadiness.js'
import {
  assertCustomerTenantContext,
  assertFeatureEntitlement,
  assertRuntimePermission,
  createRuntimeInstanceError,
  getFeatureForRuntimeType,
  toIdString,
} from './runtimeInstanceService.js'
import {
  previewKnowledgePackManifestResolution,
} from './knowledgePackManifestService.js'
import { resolveOutcomeStudioKnowledgePackBinding } from './outcomeKnowledgePackRegistryService.js'
import {
  buildRuntimeIntelligenceGraphProjection,
  buildRuntimeIntelligenceGraphQueryProjection,
} from './runtimeIntelligenceGraphService.js'
import auditService from './auditService.js'
import { authorizeOutcomeStudioLiveTestExecution } from './outcomeStudioReadinessService.js'
import {
  assertOutcomeStudioProviderSafeContext,
  assertOutcomeStudioProviderSafeRequest,
  buildOutcomeStudioProviderSafeContext,
  buildOutcomeStudioProviderSafeRequest,
  assertOutcomeStudioGenerationContextConsumption,
  OUTCOME_STUDIO_EXECUTION_EVIDENCE_STATUSES,
} from './outcomeStudioProviderSafeContextService.js'
import {
  PROVIDER_RESPONSE_SCHEMA_NAME,
  PROVIDER_RESPONSE_SCHEMA_VERSION,
} from './openAiOutcomeStudioProviderAdapter.js'
import { OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION } from './outcomeBoundaryReceiptService.js'

export const GRR_ERROR_REASONS = Object.freeze({
  RUNTIME_NOT_FOUND: 'RUNTIME_NOT_FOUND',
  CERTIFIED_TRUTH_MISSING: 'CERTIFIED_TRUTH_MISSING',
  KNOWLEDGE_BINDING_BLOCKED: 'KNOWLEDGE_BINDING_BLOCKED',
  KNOWLEDGE_BINDING_AMBIGUOUS: 'KNOWLEDGE_BINDING_AMBIGUOUS',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  IDEMPOTENCY_REQUEST_CONFLICT: 'IDEMPOTENCY_REQUEST_CONFLICT',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  AUDIT_PERSISTENCE_FAILED: 'AUDIT_PERSISTENCE_FAILED',
  EXECUTION_NOT_FOUND: 'EXECUTION_NOT_FOUND',
  LIVE_TEST_PROVIDER_CONFIGURATION_INVALID: 'LIVE_TEST_PROVIDER_CONFIGURATION_INVALID',
  LIVE_TEST_PROVIDER_RESULT_INVALID: 'LIVE_TEST_PROVIDER_RESULT_INVALID',
  PROVIDER_SAFE_CONTEXT_BLOCKED: 'PROVIDER_SAFE_CONTEXT_BLOCKED',
})

const normalizeToken = (value) => String(value || '').trim().toUpperCase()
const normalizeKey = (value) => String(value || '').trim().toLowerCase()
const normalizeCapabilityKey = (value) => normalizeKey(value)
const normalizeLegacyCapabilitySelectorKey = (value) => normalizeKey(value).replace(/_/g, '-')
const normalizeCapabilityKeys = (values) => Array.isArray(values)
  ? [...new Set(values.map(normalizeLegacyCapabilitySelectorKey).filter(Boolean))]
  : []
const normalizeText = (value) => String(value ?? '').trim()
const isStrictPlainObject = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype,
)
const buildGrrId = (prefix) => `${prefix}_${randomUUID()}`
const canUseMongoTransaction = () => mongoose.connection.readyState === 1

const hashSafeValue = (value) =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`

const hasOwnObjectValue = (source, key) =>
  Object.prototype.hasOwnProperty.call(source, key)

const isMongooseDocumentLike = (source) =>
  Boolean(source && typeof source.get === 'function' && typeof source.toObject === 'function')

const getObjectValue = (source, key) => {
  if (source === null || source === undefined || !key || typeof source !== 'object') return undefined
  if (source instanceof Map) return source.get(key)
  if (isMongooseDocumentLike(source)) {
    const value = source.get(key)
    if (value !== undefined) return value
  }
  if (hasOwnObjectValue(source, key)) return source[key]
  return undefined
}

const getValueAtPath = (source, path) => {
  const parts = normalizeText(path).split('.').filter(Boolean)
  if (parts.length === 0) return undefined

  let cursor = source
  for (const part of parts) {
    cursor = getObjectValue(cursor, part)
    if (cursor === undefined || cursor === null) return cursor
  }
  return cursor
}

const cloneValue = (value) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const clampText = (value, maxLength = 1200) => {
  const text = normalizeText(value).replace(/\s+/g, ' ')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trim()}...`
}

const createGrrError = ({
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

const liveTestConfigurationInvalid = () => createGrrError({
  status: 503,
  code: 'GRR_LIVE_TEST_PROVIDER_CONFIGURATION_INVALID',
  message: 'Live TEST provider execution is not configured correctly.',
  reason: GRR_ERROR_REASONS.LIVE_TEST_PROVIDER_CONFIGURATION_INVALID,
})

const providerSafeContextBlocked = ({
  providerContextContractVersion = 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
  safeContextPolicyKey = 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
} = {}) => createGrrError({
  status: 422,
  code: 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED',
  message: 'The request could not be projected into a provider-safe context.',
  reason: GRR_ERROR_REASONS.PROVIDER_SAFE_CONTEXT_BLOCKED,
  details: { safeContextPolicyKey, providerContextContractVersion },
})

const liveTestProviderResultInvalid = () => createGrrError({
  status: 502,
  code: 'GRR_LIVE_TEST_PROVIDER_RESULT_INVALID',
  message: 'The live TEST provider response could not be verified.',
  reason: GRR_ERROR_REASONS.LIVE_TEST_PROVIDER_RESULT_INVALID,
})

const liveTestReadinessBlocked = () => createGrrError({
  status: 409,
  code: 'GRR_LIVE_TEST_READINESS_BLOCKED',
  message: 'Outcome Studio Development/Test execution is not currently authorized.',
  reason: 'DEVELOPMENT_TEST_READINESS_BLOCKED',
})

const getRuntimeLookup = (runtimeInstanceId) => ({
  $or: [
    ...(mongoose.isValidObjectId(runtimeInstanceId) ? [{ _id: runtimeInstanceId }] : []),
    { runtimeInstanceKey: String(runtimeInstanceId || '').trim().toLowerCase() },
  ],
})

const resolveRuntimeInstance = async ({
  runtimeInstanceId,
  scopes,
  permission = 'VMF_VIEW',
} = {}) => {
  const runtimeInstance = await RuntimeInstance.findOne(getRuntimeLookup(runtimeInstanceId)).lean()

  if (!runtimeInstance) {
    throw createGrrError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Runtime instance not found.',
      reason: GRR_ERROR_REASONS.RUNTIME_NOT_FOUND,
      details: { runtimeInstanceId },
    })
  }

  const customerId = toIdString(runtimeInstance.customerId)
  const tenantId = toIdString(runtimeInstance.tenantId)

  await assertRuntimePermission({
    scopes,
    customerId,
    tenantId,
    permission,
  })

  const { customer } = await assertCustomerTenantContext({ customerId, tenantId })
  await assertFeatureEntitlement({
    customerId,
    customer,
    feature: getFeatureForRuntimeType(runtimeInstance.runtimeType),
  })

  return runtimeInstance
}

const resolveFrameworkPackage = async (runtimeInstance) => {
  const packageId = runtimeInstance?.packageId || runtimeInstance?.frameworkPackageId
  if (!packageId) return null
  const query = FrameworkPackage.findById(packageId)
  return typeof query?.lean === 'function' ? await query.lean() : query
}

const getFrameworkState = (runtimeInstance = {}) =>
  getObjectValue(runtimeInstance, 'framework_state')
  || getObjectValue(runtimeInstance, 'frameworkState')
  || {}

const getRuntimeScope = (runtimeInstance = {}) => ({
  tenantId: runtimeInstance.tenantId,
  customerId: runtimeInstance.customerId,
  runtimeInstanceId: runtimeInstance._id || runtimeInstance.id,
  runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
  runtimeType: runtimeInstance.runtimeType || '',
  frameworkKey: runtimeInstance.frameworkKey || '',
  packageKey: runtimeInstance.packageKey || '',
  packageVersion: runtimeInstance.packageVersion || '',
})

const getCanonicalOutputEligibility = (frameworkState = {}) => {
  const lock = getObjectValue(frameworkState, 'lock') || {}
  const outputEligibility = getObjectValue(lock, 'outputEligibility') || {}
  const replayAnchor = getObjectValue(lock, 'replayAnchor') || getObjectValue(lock, 'anchor') || {}
  const publish = getObjectValue(frameworkState, 'publish') || {}

  return {
    locked: Boolean(getObjectValue(lock, 'locked') === true || normalizeToken(getObjectValue(lock, 'state')) === 'LOCKED'),
    published: Boolean(getObjectValue(publish, 'published') === true || normalizeToken(getObjectValue(publish, 'state')) === 'PUBLISHED'),
    outputEligible: getObjectValue(outputEligibility, 'outputEligible') === true,
    canonicalOutputEligible: getObjectValue(outputEligibility, 'canonicalOutputEligible') === true,
    anchorEligible: getObjectValue(outputEligibility, 'anchorEligible') === true,
    intelligenceEligible: getObjectValue(outputEligibility, 'intelligenceEligible') === true,
    publishSnapshotId: getObjectValue(getObjectValue(publish, 'snapshot') || {}, 'snapshotId')
      || getObjectValue(getObjectValue(lock, 'publish') || {}, 'snapshotId')
      || '',
    publishSnapshotHash: getObjectValue(getObjectValue(publish, 'snapshot') || {}, 'snapshotHash')
      || getObjectValue(getObjectValue(lock, 'publish') || {}, 'snapshotHash')
      || '',
    lockSnapshotId: getObjectValue(getObjectValue(lock, 'snapshot') || {}, 'snapshotId') || '',
    lockSnapshotHash: getObjectValue(getObjectValue(lock, 'snapshot') || {}, 'snapshotHash') || '',
    replayAnchorId: getObjectValue(replayAnchor, 'replayAnchorId') || getObjectValue(replayAnchor, 'anchorId') || '',
    replayAnchorHash: getObjectValue(replayAnchor, 'replayAnchorHash') || getObjectValue(replayAnchor, 'anchorHash') || '',
  }
}

const getAcceptedContent = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return normalizeText(value)
  const content = getObjectValue(value, 'content')
  const summary = getObjectValue(value, 'summary')
  const acceptedValue = getObjectValue(value, 'value')
  if (typeof content === 'string') return normalizeText(content)
  if (typeof summary === 'string') return normalizeText(summary)
  if (typeof acceptedValue === 'string') return normalizeText(acceptedValue)
  return ''
}

const getSectionLabel = (section = {}, fallback = '') =>
  normalizeText(getObjectValue(section, 'label'))
  || normalizeText(getObjectValue(section, 'title'))
  || normalizeText(getObjectValue(section, 'name'))
  || normalizeText(getObjectValue(section, 'sectionLabel'))
  || normalizeText(getObjectValue(section, 'sectionKey'))
  || fallback

const getAcceptedTruthRecords = ({ frameworkPackage, frameworkState }) => {
  const packageSections = Array.isArray(frameworkPackage?.sections) ? frameworkPackage.sections : []
  const runtimeSections = getObjectValue(frameworkState, 'sections') || {}
  return packageSections.map((packageSection, index) => {
    const sectionKey = normalizeKey(
      getObjectValue(packageSection, 'sectionKey')
      || getObjectValue(packageSection, 'key'),
    )
    const runtimePath = normalizeText(getObjectValue(packageSection, 'runtimePath'))
    const runtimePathSection = getValueAtPath({ framework_state: frameworkState }, runtimePath)
    const runtimeSection = runtimePathSection || getObjectValue(runtimeSections, sectionKey) || {}
    const accepted = getObjectValue(runtimeSection, 'accepted') || {}
    const content = getAcceptedContent(accepted)
    return {
      sectionKey,
      runtimePath,
      label: getSectionLabel(packageSection, `Section ${index + 1}`),
      required: getObjectValue(packageSection, 'required') === true,
      content,
      acceptedAt: getObjectValue(accepted, 'acceptedAt') || null,
      acceptedBy: toIdString(getObjectValue(accepted, 'acceptedBy')),
      truthHash: getObjectValue(accepted, 'truthHash') || (content ? hashSafeValue({ sectionKey, content }) : ''),
    }
  }).filter((record) => record.sectionKey || record.runtimePath || record.content)
}

const summarizeTruthRecord = (record) => ({
  sectionKey: record.sectionKey,
  label: record.label,
  summary: clampText(record.content, 700),
  acceptedAt: record.acceptedAt || null,
  truthHash: record.truthHash || '',
})

const getGraphReadiness = (frameworkState = {}) => {
  const graph = frameworkState.intelligence_graph || {}
  const projection = buildRuntimeIntelligenceGraphProjection(graph)
  const readinessQuery = buildRuntimeIntelligenceGraphQueryProjection(projection, 'readiness')
  return {
    available: readinessQuery.available === true,
    graphVersion: readinessQuery.graphVersion || projection.graphVersion || '',
    graphHash: readinessQuery.graphHash || projection.graphHash || '',
    state: readinessQuery.readiness?.state || readinessQuery.health?.state || projection.health?.state || '',
    error: readinessQuery.error || null,
  }
}

const buildCertifiedTruthContext = ({ frameworkPackage, runtimeInstance }) => {
  const frameworkState = getFrameworkState(runtimeInstance)
  const outputEligibility = getCanonicalOutputEligibility(frameworkState)
  const graph = getGraphReadiness(frameworkState)
  const acceptedTruth = getAcceptedTruthRecords({ frameworkPackage, frameworkState })
  const requiredTruth = acceptedTruth.filter((record) => record.required)
  const missingRequiredTruth = requiredTruth.filter((record) => !record.content)
  const blockers = []

  if (normalizeToken(runtimeInstance?.runtimeType) !== RUNTIME_TYPES.VALUE_NARRATIVE) {
    blockers.push({
      code: 'UNSUPPORTED_RUNTIME_TYPE',
      message: 'GRR V1 supports VMF Value Narrative runtimes only.',
    })
  }

  if (!outputEligibility.published) {
    blockers.push({
      code: 'RUNTIME_NOT_PUBLISHED',
      message: 'Published runtime truth is required before governed reasoning.',
    })
  }

  if (!outputEligibility.locked) {
    blockers.push({
      code: 'RUNTIME_NOT_LOCKED',
      message: 'Locked canonical runtime truth is required before governed reasoning.',
    })
  }

  if (
    !outputEligibility.outputEligible
    || !outputEligibility.canonicalOutputEligible
    || !outputEligibility.anchorEligible
    || !outputEligibility.intelligenceEligible
  ) {
    blockers.push({
      code: 'OUTPUT_ELIGIBILITY_MISSING',
      message: 'Canonical output eligibility is missing or incomplete.',
    })
  }

  if (!outputEligibility.lockSnapshotId || !outputEligibility.lockSnapshotHash) {
    blockers.push({
      code: 'LOCK_SNAPSHOT_MISSING',
      message: 'Lock snapshot proof is required before governed reasoning.',
    })
  }

  if (!outputEligibility.replayAnchorId) {
    blockers.push({
      code: 'REPLAY_ANCHOR_MISSING',
      message: 'Replay anchor proof is required before governed reasoning.',
    })
  }

  if (!graph.available) {
    blockers.push({
      code: graph.error?.code || 'GRAPH_QUERY_UNAVAILABLE',
      message: graph.error?.message || 'A valid intelligence graph readiness projection is required.',
    })
  }

  if (!frameworkPackage) {
    blockers.push({
      code: 'FRAMEWORK_PACKAGE_MISSING',
      message: 'Framework package metadata is required before governed reasoning.',
    })
  }

  if (acceptedTruth.filter((record) => record.content).length === 0) {
    blockers.push({
      code: 'CERTIFIED_TRUTH_MISSING',
      message: 'Accepted or canonical section truth is required before governed reasoning.',
    })
  }

  const missingIdentityTruth = acceptedTruth.filter((record) => record.content && !record.sectionKey)
  if (missingIdentityTruth.length > 0) {
    blockers.push({
      code: 'CERTIFIED_TRUTH_IDENTITY_MISSING',
      message: 'Accepted runtime truth requires a stable section identity before governed reasoning.',
      field: 'acceptedTruth.sectionKey',
    })
  }

  if (missingRequiredTruth.length > 0) {
    blockers.push({
      code: 'REQUIRED_TRUTH_MISSING',
      message: 'One or more required runtime sections do not have accepted truth.',
      sectionKeys: missingRequiredTruth.map((record) => record.sectionKey).filter(Boolean),
    })
  }

  return {
    canExecute: blockers.length === 0,
    blockers,
    acceptedTruth,
    summary: {
      acceptedTruthCount: acceptedTruth.filter((record) => record.content).length,
      requiredTruthCount: requiredTruth.length,
      missingRequiredTruthCount: missingRequiredTruth.length,
      outputEligibility,
      graph: {
        available: graph.available,
        graphVersion: graph.graphVersion,
        graphHash: graph.graphHash,
        state: graph.state,
      },
      sourceTruthSummary: acceptedTruth.filter((record) => record.content).map(summarizeTruthRecord),
    },
  }
}

const assertCertifiedTruthReady = (truthContext) => {
  if (truthContext.canExecute) return

  throw createGrrError({
    status: 409,
    code: 'GRR_CERTIFIED_TRUTH_BLOCKED',
    message: truthContext.blockers[0]?.message || 'Certified Truth is required before governed reasoning.',
    reason: GRR_ERROR_REASONS.CERTIFIED_TRUTH_MISSING,
    details: {
      blockers: truthContext.blockers,
    },
  })
}

const resolveKnowledgeBinding = async ({
  deps = {},
  manifestId,
  query,
} = {}) => {
  if (typeof deps.resolveKnowledgeBinding === 'function') {
    return deps.resolveKnowledgeBinding({ manifestId, query })
  }

  return manifestId
    ? previewKnowledgePackManifestResolution({ manifestId, query })
    : resolveOutcomeStudioKnowledgePackBinding({ query })
}

const assertKnowledgeBindingReady = ({ manifest, binding }) => {
  const status = normalizeToken(binding?.status)
  if (!binding || status === 'BLOCKED' || status === 'AMBIGUOUS') {
    const ambiguous = status === 'AMBIGUOUS'
    throw createGrrError({
      status: 409,
      code: ambiguous
        ? 'GRR_KNOWLEDGE_BINDING_AMBIGUOUS'
        : 'GRR_KNOWLEDGE_BINDING_BLOCKED',
      message: ambiguous
        ? 'Knowledge Pack Registry resolution is ambiguous.'
        : 'Knowledge Pack Registry resolution is blocked.',
      reason: ambiguous
        ? GRR_ERROR_REASONS.KNOWLEDGE_BINDING_AMBIGUOUS
        : GRR_ERROR_REASONS.KNOWLEDGE_BINDING_BLOCKED,
      details: {
        manifestId: manifest?.manifestId || null,
        status: binding?.status || null,
        blockers: binding?.blockers
          || binding?.missingDependencies
          || binding?.resolution?.missingDependencies
          || binding?.resolution?.blockers
          || [],
        ambiguousCandidates: binding?.ambiguousCandidates
          || binding?.resolution?.ambiguousCandidates
          || [],
      },
    })
  }
}

const sanitizeDependencyReference = (reference = {}) => ({
  knowledgeLayer: normalizeToken(reference.knowledgeLayer),
  requirement: normalizeToken(reference.requirement),
  packType: normalizeToken(reference.packType),
  packKey: normalizeKey(reference.packKey),
  capabilityKey: normalizeKey(reference.capabilityKey),
})

const sanitizePack = (pack = {}) => ({
  packType: normalizeToken(pack.packType),
  packKey: normalizeKey(pack.packKey),
  versionId: normalizeText(pack.versionId),
  semanticVersion: normalizeText(pack.semanticVersion),
  contentHash: normalizeText(pack.contentHash),
  label: normalizeText(pack.label),
  purposeCategory: normalizeToken(pack.purposeCategory),
  knowledgeLayer: normalizeToken(pack.knowledgeLayer),
  capabilityKey: normalizeKey(pack.capabilityKey),
  workspaceCompatibility: Array.isArray(pack.workspaceCompatibility)
    ? pack.workspaceCompatibility.map(normalizeToken).filter(Boolean)
    : [],
  dependencyReferences: Array.isArray(pack.dependencyReferences)
    ? pack.dependencyReferences.map(sanitizeDependencyReference)
    : [],
  executionMode: normalizeToken(pack.executionMode),
  boundary: normalizeToken(pack.boundary),
  scopeType: normalizeToken(pack.scopeType),
  scopeKey: normalizeText(pack.scopeKey),
})

const sanitizeDependencyGraph = (dependencyGraph = {}) => ({
  status: normalizeToken(dependencyGraph.status || 'NOT_AVAILABLE') || 'NOT_AVAILABLE',
  edgeCount: Number.isFinite(Number(dependencyGraph.edgeCount))
    ? Number(dependencyGraph.edgeCount)
    : Array.isArray(dependencyGraph.edges) ? dependencyGraph.edges.length : 0,
  edges: Array.isArray(dependencyGraph.edges)
    ? dependencyGraph.edges.map((edge) => ({
        from: normalizeText(edge.from),
        to: normalizeText(edge.to),
        fromPackKey: normalizeKey(edge.fromPackKey),
        toPackKey: normalizeKey(edge.toPackKey),
      })).filter((edge) => edge.from || edge.to || edge.fromPackKey || edge.toPackKey)
    : [],
})

const sanitizeKnowledgeResolution = (resolution = {}) => ({
  status: normalizeToken(resolution.status || 'PROJECTED') || 'PROJECTED',
  activeCount: Number.isFinite(Number(resolution.activeCount)) ? Number(resolution.activeCount) : 0,
  resolvedCount: Number.isFinite(Number(resolution.resolvedCount)) ? Number(resolution.resolvedCount) : 0,
  requiredCount: Number.isFinite(Number(resolution.requiredCount)) ? Number(resolution.requiredCount) : 0,
  optionalCount: Number.isFinite(Number(resolution.optionalCount)) ? Number(resolution.optionalCount) : 0,
  validationCount: Number.isFinite(Number(resolution.validationCount)) ? Number(resolution.validationCount) : 0,
  blockedCount: Number.isFinite(Number(resolution.blockedCount)) ? Number(resolution.blockedCount) : 0,
  requestedContextCategories: Array.isArray(resolution.requestedContextCategories)
    ? resolution.requestedContextCategories.map(normalizeToken).filter(Boolean)
    : [],
  policyVersion: normalizeText(resolution.policyVersion),
  requestedOutputTypeKey: normalizeKey(resolution.request?.requestedOutputTypeKey),
  requestedStyleKey: normalizeKey(resolution.request?.requestedStyleKey),
})

const sanitizeKnowledgeLineage = (lineage = {}) => ({
  resolvedAt: normalizeText(lineage.resolvedAt),
  activationIds: Array.isArray(lineage.activationIds)
    ? lineage.activationIds.map(normalizeText).filter(Boolean)
    : [],
  versionIds: Array.isArray(lineage.versionIds)
    ? lineage.versionIds.map(normalizeText).filter(Boolean)
    : [],
  contentHashes: Array.isArray(lineage.contentHashes)
    ? lineage.contentHashes.map(normalizeText).filter(Boolean)
    : [],
})

const sanitizeSelectedByLayer = (selectedByLayer = {}) => Object.fromEntries(
  Object.entries(selectedByLayer)
    .map(([layer, packs]) => [
      normalizeToken(layer),
      Array.isArray(packs) ? packs.map(sanitizePack) : [],
    ])
    .filter(([layer]) => Boolean(layer)),
)

const buildKnowledgeContext = ({ manifest, binding, payload }) => ({
  manifest: {
    sourceType: manifest?.sourceType || binding?.resolutionSource || null,
    policyKey: manifest?.policyKey || binding?.policyKey || null,
    policyVersion: manifest?.policyVersion || binding?.policyVersion || null,
    manifestId: manifest?.manifestId || binding?.manifestId || null,
    manifestKey: manifest?.manifestKey || binding?.manifestKey || null,
    manifestName: manifest?.manifestName || null,
    semanticVersion: manifest?.semanticVersion || binding?.manifestVersion || null,
    status: manifest?.status || null,
  },
  binding: {
    status: binding?.status || 'UNKNOWN',
    mode: binding?.mode || null,
    contentVisible: false,
    packContentLoaded: false,
    requiredPacks: Array.isArray(binding?.requiredPacks) ? binding.requiredPacks.map(sanitizePack) : [],
    optionalPacks: Array.isArray(binding?.optionalPacks) ? binding.optionalPacks.map(sanitizePack) : [],
    validationPacks: Array.isArray(binding?.validationPacks) ? binding.validationPacks.map(sanitizePack) : [],
    providerContextPacks: Array.isArray(binding?.providerContextPacks)
      ? binding.providerContextPacks.map(sanitizePack)
      : [],
    preValidationPacks: Array.isArray(binding?.preValidationPacks)
      ? binding.preValidationPacks.map(sanitizePack)
      : [],
    postValidationPacks: Array.isArray(binding?.postValidationPacks)
      ? binding.postValidationPacks.map(sanitizePack)
      : [],
    lineageCertificationPacks: Array.isArray(binding?.lineageCertificationPacks)
      ? binding.lineageCertificationPacks.map(sanitizePack)
      : [],
    systemOnlyPacks: Array.isArray(binding?.systemOnlyPacks)
      ? binding.systemOnlyPacks.map(sanitizePack)
      : [],
    selectedByLayer: sanitizeSelectedByLayer(binding?.selectedByLayer),
    dependencyGraph: sanitizeDependencyGraph(binding?.dependencyGraph || {}),
    resolution: sanitizeKnowledgeResolution(binding?.resolution || {}),
    lineage: sanitizeKnowledgeLineage(binding?.lineage || binding?.resolution?.lineage || {}),
  },
  request: {
    outputTypeKey: normalizeToken(payload?.outputTypeKey),
    requestedOutputTypeKey: normalizeCapabilityKey(
      payload?.requestedOutputTypeKey || payload?.outputTypeKey,
    ),
    requestedStyleKey: normalizeKey(payload?.requestedStyleKey),
    contextCategories: Array.isArray(payload?.contextCategories)
      ? payload.contextCategories.map(normalizeToken).filter(Boolean)
      : [],
  },
})

const resolveProviderPosture = () => {
  const configuredMode = normalizeToken(process.env.STORYLINEOS_GRR_PROVIDER_MODE)
  const deterministicEnabled = configuredMode === 'DETERMINISTIC'
    || configuredMode === GRR_PROVIDER_MODES.DETERMINISTIC_TEST
    || process.env.STORYLINEOS_GRR_DETERMINISTIC_PROVIDER_ENABLED === 'true'

  if (deterministicEnabled && process.env.NODE_ENV !== 'production') {
    return {
      mode: GRR_PROVIDER_MODES.DETERMINISTIC_TEST,
      providerKey: 'storylineos-deterministic-test-provider',
      liveProvider: false,
    }
  }

  throw createGrrError({
    status: 409,
    code: 'GRR_PROVIDER_UNAVAILABLE',
    message: 'Governed reasoning provider execution is not configured.',
    reason: GRR_ERROR_REASONS.PROVIDER_UNAVAILABLE,
    details: {
      providerMode: configuredMode || 'UNCONFIGURED',
      deterministicProviderAllowed: process.env.NODE_ENV !== 'production',
    },
  })
}

const buildProviderRequestProjection = (payload = {}) => ({
  outputTypeKey: normalizeToken(payload.outputTypeKey),
  requestedOutputTypeKey: normalizeCapabilityKey(
    payload.requestedOutputTypeKey || payload.outputTypeKey,
  ),
  requestedStyleKey: normalizeKey(payload.requestedStyleKey),
  audienceKeys: Array.isArray(payload.audienceKeys)
    ? payload.audienceKeys.map(normalizeKey).filter(Boolean)
    : [],
  industryKeys: Array.isArray(payload.industryKeys)
    ? payload.industryKeys.map(normalizeKey).filter(Boolean)
    : [],
  languageKey: normalizeKey(payload.languageKey),
  channelKey: normalizeKey(payload.channelKey),
  workspaceType: normalizeToken(payload.workspaceType || 'PLATFORM'),
  environmentKey: normalizeToken(payload.environmentKey || 'PRODUCTION'),
  manifestId: normalizeText(payload.manifestId),
  contextCategories: Array.isArray(payload.contextCategories)
    ? payload.contextCategories.map(normalizeToken).filter(Boolean)
    : [],
  executionIntent: clampText(payload.executionIntent, 2000),
})

const LIVE_TEST_DESCRIPTOR_KEYS = Object.freeze([
  'providerKey',
  'model',
  'providerMode',
  'environment',
  'safeContextPolicyKey',
  'failurePosture',
])

const PROVIDER_RESULT_DESCRIPTOR_KEYS = Object.freeze([
  'providerKey',
  'model',
  'providerMode',
  'liveProvider',
])

const PROVIDER_INPUT_KEYS = Object.freeze(['customerPrompt', 'currentDraftMarkdown', 'request'])
const PROVIDER_INPUT_REQUEST_KEYS = Object.freeze([
  'intentType',
  'refinement',
  'outputTypeKey',
  'outputTypeLabel',
  'outputSchemaKey',
  'requiredSections',
  'styleKey',
  'styleLabel',
  'requestedOutputTypeKey',
  'requestedStyleKey',
  'workspaceType',
])
const AUTHORIZATION_KEYS = Object.freeze(['policyVersion', 'revision', 'verdict', 'providerAuthority', 'referenceSnapshots'])
const REFERENCE_SNAPSHOT_KEYS = Object.freeze(['family', 'referenceKey', 'referenceRevision', 'sha256', 'byteLength', 'mimeType'])
const STABLE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?$/
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/

const hasMalformedUtf16 = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true
      index += 1
    } else if (code >= 0xDC00 && code <= 0xDFFF) return true
  }
  return false
}

const hasExactPlainKeys = (value, keys) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)),
)

export const resolveLiveTestConfiguration = (deps = {}) => {
  const executionMode = deps.executionMode === undefined ? 'LEGACY' : deps.executionMode
  if (!['LEGACY', 'LIVE_TEST'].includes(executionMode)) throw liveTestConfigurationInvalid()
  if (executionMode === 'LEGACY') return { executionMode }

  const providerDescriptor = deps.providerDescriptor
  const authorizeLiveTest = deps.authorizeLiveTest === undefined
    ? authorizeOutcomeStudioLiveTestExecution
    : deps.authorizeLiveTest
  const buildProviderSafeRequest = deps.buildProviderSafeRequest === undefined
    ? buildOutcomeStudioProviderSafeRequest
    : deps.buildProviderSafeRequest
  const buildProviderSafeContext = deps.buildProviderSafeContext === undefined
    ? buildOutcomeStudioProviderSafeContext
    : deps.buildProviderSafeContext
  const assertProviderSafeContext = deps.assertProviderSafeContext === undefined
    ? assertOutcomeStudioProviderSafeContext
    : deps.assertProviderSafeContext
  const providerContextContractVersion = deps.providerContextContractVersion === undefined
    ? providerDescriptor?.safeContextPolicyKey
    : deps.providerContextContractVersion
  const providerContextBindingFingerprint = deps.providerContextBindingFingerprint === undefined
    ? ''
    : deps.providerContextBindingFingerprint
  if (typeof deps.providerAdapter !== 'function'
    || typeof authorizeLiveTest !== 'function'
    || typeof buildProviderSafeRequest !== 'function'
    || typeof buildProviderSafeContext !== 'function'
    || typeof assertProviderSafeContext !== 'function'
    || !hasExactPlainKeys(providerDescriptor, LIVE_TEST_DESCRIPTOR_KEYS)
    || typeof providerDescriptor.providerKey !== 'string'
    || providerDescriptor.providerKey !== providerDescriptor.providerKey.trim().toLowerCase()
    || !STABLE_KEY_PATTERN.test(providerDescriptor.providerKey)
    || typeof providerDescriptor.model !== 'string'
    || providerDescriptor.model !== providerDescriptor.model.trim()
    || providerDescriptor.model.length < 1
    || providerDescriptor.model.length > 160
    || hasMalformedUtf16(providerDescriptor.model)
    || CONTROL_PATTERN.test(providerDescriptor.model)
    || providerDescriptor.providerMode !== 'LIVE_TEST'
    || providerDescriptor.environment !== 'TEST'
    || providerDescriptor.safeContextPolicyKey !== 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1'
    || typeof providerContextContractVersion !== 'string'
    || providerContextContractVersion !== providerContextContractVersion.trim()
    || !providerContextContractVersion
    || providerContextContractVersion.length > 160
    || hasMalformedUtf16(providerContextContractVersion)
    || CONTROL_PATTERN.test(providerContextContractVersion)
    || (providerContextBindingFingerprint && !SHA256_PATTERN.test(providerContextBindingFingerprint))
    || providerDescriptor.failurePosture !== 'FAIL_CLOSED') throw liveTestConfigurationInvalid()
  return {
    executionMode,
    providerAdapter: deps.providerAdapter,
    providerDescriptor: { ...providerDescriptor },
    authorizeLiveTest,
    buildProviderSafeRequest,
    buildProviderSafeContext,
    assertProviderSafeContext,
    providerContextContractVersion,
    providerContextBindingFingerprint,
  }
}

const assertLiveTestSelectorIdentity = ({ errorIdentity, payload, providerInput }) => {
  const request = providerInput?.request
  const matches = hasExactPlainKeys(providerInput, PROVIDER_INPUT_KEYS)
    && hasExactPlainKeys(request, PROVIDER_INPUT_REQUEST_KEYS)
    && normalizeToken(request.outputTypeKey) === normalizeToken(payload.outputTypeKey)
    && normalizeCapabilityKey(request.requestedOutputTypeKey) === normalizeCapabilityKey(payload.requestedOutputTypeKey || payload.outputTypeKey)
    && normalizeKey(request.requestedStyleKey) === normalizeKey(payload.requestedStyleKey)
    && normalizeToken(request.workspaceType) === normalizeToken(payload.workspaceType || 'PLATFORM')
  if (!matches) throw providerSafeContextBlocked(errorIdentity)
}

const assertSafeRequestSelectorIdentity = ({ errorIdentity, payload, safeRequest }) => {
  const businessRequest = safeRequest?.businessRequest
  const matches = normalizeToken(businessRequest?.outputTypeKey) === normalizeToken(payload.outputTypeKey)
    && normalizeCapabilityKey(businessRequest?.requestedOutputTypeKey) === normalizeCapabilityKey(payload.requestedOutputTypeKey || payload.outputTypeKey)
    && normalizeKey(businessRequest?.requestedStyleKey) === normalizeKey(payload.requestedStyleKey)
    && normalizeToken(businessRequest?.workspaceType) === normalizeToken(payload.workspaceType || 'PLATFORM')
  if (!matches) throw providerSafeContextBlocked(errorIdentity)
}

const assertSafeRequestResult = (value, errorIdentity) => {
  try {
    return assertOutcomeStudioProviderSafeRequest(value)
  } catch {
    throw providerSafeContextBlocked(errorIdentity)
  }
}

const assertProviderContextResult = (value, safeRequest, {
  assertProviderSafeContext,
  errorIdentity,
  expectedContractVersion,
}) => {
  try {
    const result = assertProviderSafeContext(value)
    if (result?.contractVersion !== expectedContractVersion
      || JSON.stringify(result.businessRequest) !== JSON.stringify(safeRequest.businessRequest)
      || JSON.stringify(result.draftContext) !== JSON.stringify(safeRequest.draftContext)) {
      throw providerSafeContextBlocked(errorIdentity)
    }
    return result
  } catch {
    throw providerSafeContextBlocked(errorIdentity)
  }
}

const assertLiveTestAuthorizationResult = (value, providerDescriptor) => {
  const valid = hasExactPlainKeys(value, AUTHORIZATION_KEYS)
    && value.policyVersion === OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.DEVELOPMENT_TEST
    && Number.isSafeInteger(value.revision)
    && value.revision > 0
    && value.verdict === 'READY_FOR_TESTING'
    && hasExactPlainKeys(value.providerAuthority, LIVE_TEST_DESCRIPTOR_KEYS)
    && LIVE_TEST_DESCRIPTOR_KEYS.every((key) => value.providerAuthority[key] === providerDescriptor[key])
    && Array.isArray(value.referenceSnapshots)
    && value.referenceSnapshots.length === OUTCOME_STUDIO_REFERENCE_FAMILIES.length
    && value.referenceSnapshots.every((snapshot, index) => hasExactPlainKeys(snapshot, REFERENCE_SNAPSHOT_KEYS)
      && snapshot.family === OUTCOME_STUDIO_REFERENCE_FAMILIES[index]
      && typeof snapshot.referenceKey === 'string'
      && UUID_V4_PATTERN.test(snapshot.referenceKey)
      && Number.isSafeInteger(snapshot.referenceRevision)
      && snapshot.referenceRevision > 0
      && typeof snapshot.sha256 === 'string'
      && SHA256_PATTERN.test(snapshot.sha256)
      && Number.isSafeInteger(snapshot.byteLength)
      && snapshot.byteLength > 0
      && snapshot.mimeType === 'application/pdf')
  if (!valid) throw liveTestReadinessBlocked()
  return value
}

const buildLiveTestEffectivePayload = ({ payload, safeRequest }) => ({
  ...payload,
  outputTypeKey: safeRequest.businessRequest.outputTypeKey,
  requestedOutputTypeKey: safeRequest.businessRequest.requestedOutputTypeKey,
  requestedStyleKey: safeRequest.businessRequest.requestedStyleKey,
  workspaceType: safeRequest.businessRequest.workspaceType,
  executionIntent: safeRequest.effectiveRequest.executionIntent,
})

const assertProviderEvidence = ({ provider, providerDescriptor, conflict = false }) => {
  const matches = hasExactPlainKeys(provider, PROVIDER_RESULT_DESCRIPTOR_KEYS)
    && provider.providerKey === providerDescriptor.providerKey
    && provider.model === providerDescriptor.model
    && provider.providerMode === 'LIVE_TEST'
    && provider.liveProvider === true
  if (matches) return
  if (conflict) {
    throw createGrrError({
      status: 409,
      code: 'GRR_IDEMPOTENCY_REQUEST_CONFLICT',
      message: 'The idempotency key is already associated with a different governed reasoning request.',
      reason: GRR_ERROR_REASONS.IDEMPOTENCY_REQUEST_CONFLICT,
      details: { fingerprintState: 'PROVIDER_MISMATCHED' },
    })
  }
  throw liveTestProviderResultInvalid()
}

const assertStrictProviderResponseSchema = (providerResult = {}) => {
  const responseSchema = providerResult?.metadata?.responseSchema
  const valid = responseSchema
    && responseSchema.name === PROVIDER_RESPONSE_SCHEMA_NAME
    && responseSchema.version === PROVIDER_RESPONSE_SCHEMA_VERSION
    && responseSchema.strict === true
    && responseSchema.parsed === true
  if (!valid) throw liveTestProviderResultInvalid()
}

const buildPersistedProviderEvidence = ({ executionMode, providerDescriptor, providerResult }) => {
  if (executionMode === 'LIVE_TEST') {
    return {
      providerKey: providerDescriptor.providerKey,
      model: providerDescriptor.model,
      providerMode: 'LIVE_TEST',
      liveProvider: true,
    }
  }
  return providerResult?.provider || {}
}

const buildLiveTestRequestFingerprint = ({
  payload,
  providerContextBindingFingerprint,
  providerContextContractVersion,
  providerDescriptor,
  runtimeInstance,
  safeRequest,
  generationContextConsumptionFingerprint = '',
}) => hashSafeValue({
  fingerprintVersion: 'GRR_REQUEST_V2',
  manifestQuery: buildManifestQuery({ payload, runtimeInstance }),
  providerAuthority: {
    providerKey: providerDescriptor.providerKey,
    model: providerDescriptor.model,
    providerMode: providerDescriptor.providerMode,
    environment: providerDescriptor.environment,
    safeContextPolicyKey: providerDescriptor.safeContextPolicyKey,
    failurePosture: providerDescriptor.failurePosture,
  },
  providerRequest: buildProviderRequestProjection(payload),
  draftContext: safeRequest.draftContext,
  providerContextContractVersion,
  providerContextBindingFingerprint,
  ...(generationContextConsumptionFingerprint ? { generationContextConsumptionFingerprint } : {}),
})

const buildTruthSource = (truthContext = {}) => {
  const acceptedTruth = (Array.isArray(truthContext.acceptedTruth) ? truthContext.acceptedTruth : [])
    .filter((record) => typeof record?.content === 'string' && record.content)
    .map((record) => {
      const label = normalizeKey(record.sectionKey)
      if (!label) {
        throw createGrrError({
          status: 409,
          code: 'GRR_CERTIFIED_TRUTH_BLOCKED',
          message: 'Certified Truth requires a stable section identity before governed reasoning.',
          reason: GRR_ERROR_REASONS.CERTIFIED_TRUTH_MISSING,
          details: { field: 'acceptedTruth.sectionKey' },
        })
      }
      return { label, content: record.content }
    })
  return { acceptedTruth }
}

const getProviderExecutionPacks = (binding = {}) => [
  ...(Array.isArray(binding.providerContextPacks) ? binding.providerContextPacks : []),
  ...(Array.isArray(binding.preValidationPacks) ? binding.preValidationPacks : []),
  ...(Array.isArray(binding.postValidationPacks) ? binding.postValidationPacks : []),
].filter((pack) => resolveKnowledgePackBoundary(pack) === KNOWLEDGE_PACK_BOUNDARIES.GENERATION_CONTEXT)

const getBoundaryExecutionPacks = (binding = {}) => [
  ...(Array.isArray(binding.preValidationPacks) ? binding.preValidationPacks : []),
  ...(Array.isArray(binding.postValidationPacks) ? binding.postValidationPacks : []),
  ...(Array.isArray(binding.lineageCertificationPacks) ? binding.lineageCertificationPacks : []),
  ...(Array.isArray(binding.systemOnlyPacks) ? binding.systemOnlyPacks : []),
].filter((pack) => resolveKnowledgePackBoundary(pack) !== KNOWLEDGE_PACK_BOUNDARIES.GENERATION_CONTEXT)

export const buildGovernedReasoningProviderSelection = (binding = {}) => {
  const source = getProviderExecutionPacks(binding)
  const seen = new Set()
  const selection = []
  for (const pack of source) {
    const versionId = normalizeText(pack?.versionId)
    if (!versionId || seen.has(versionId)) continue
    seen.add(versionId)
    selection.push({
      versionId,
      knowledgeLayer: normalizeToken(pack?.knowledgeLayer),
      executionMode: normalizeToken(pack?.executionMode),
      ...(normalizeToken(pack?.packType) ? { packType: normalizeToken(pack.packType) } : {}),
    })
  }
  return selection
}

export const buildGovernedReasoningBoundarySelection = (binding = {}) => {
  const source = getBoundaryExecutionPacks(binding)
  const seen = new Set()
  const selection = []
  for (const pack of source) {
    const versionId = normalizeText(pack?.versionId)
    if (!versionId || seen.has(versionId)) continue
    seen.add(versionId)
    selection.push({
      versionId,
      knowledgeLayer: normalizeToken(pack?.knowledgeLayer),
      executionMode: normalizeToken(pack?.executionMode),
      ...(normalizeToken(pack?.packType) ? { packType: normalizeToken(pack.packType) } : {}),
    })
  }
  return selection
}

const buildKnowledgeExecutionBindings = (binding = {}) => {
  const seen = new Set()
  return getProviderExecutionPacks(binding).reduce((bindings, pack) => {
    const versionId = normalizeText(pack?.versionId)
    if (!versionId || seen.has(versionId)) return bindings
    seen.add(versionId)
    bindings.push({
      versionId,
      contentHash: normalizeText(pack?.contentHash),
    })
    return bindings
  }, [])
}

const buildBoundaryExecutionBindings = (binding = {}) => {
  const seen = new Set()
  return getBoundaryExecutionPacks(binding).reduce((bindings, pack) => {
    const versionId = normalizeText(pack?.versionId)
    if (!versionId || seen.has(versionId)) return bindings
    seen.add(versionId)
    bindings.push({
      versionId,
      contentHash: normalizeText(pack?.contentHash),
    })
    return bindings
  }, [])
}

const buildBoundaryReceiptPlaceholders = (binding = {}) => {
  const source = [
    ...(Array.isArray(binding.requiredPacks) ? binding.requiredPacks : []),
    ...(Array.isArray(binding.optionalPacks) ? binding.optionalPacks : []),
    ...(Array.isArray(binding.providerContextPacks) ? binding.providerContextPacks : []),
    ...(Array.isArray(binding.preValidationPacks) ? binding.preValidationPacks : []),
    ...(Array.isArray(binding.postValidationPacks) ? binding.postValidationPacks : []),
    ...(Array.isArray(binding.lineageCertificationPacks) ? binding.lineageCertificationPacks : []),
    ...(Array.isArray(binding.systemOnlyPacks) ? binding.systemOnlyPacks : []),
  ]
  const seen = new Set()
  return source.reduce((receipts, pack) => {
    const versionId = normalizeText(pack?.versionId)
    const contentHash = normalizeText(pack?.contentHash)
    const boundary = resolveKnowledgePackBoundary(pack)
    if (!versionId || !contentHash || !boundary || seen.has(versionId)) return receipts
    seen.add(versionId)
    if (boundary === KNOWLEDGE_PACK_BOUNDARIES.GENERATION_CONTEXT) return receipts
    receipts.push({
      versionId,
      contentHash,
      knowledgeLayer: normalizeToken(pack?.knowledgeLayer),
      executionMode: normalizeToken(pack?.executionMode),
      packType: normalizeToken(pack?.packType),
      boundary,
      receiptType: resolveKnowledgePackReceiptType(pack),
      contractVersion: OUTCOME_BOUNDARY_RECEIPT_CONTRACT_VERSION,
      receiptKey: '',
      validatorKey: '',
      result: 'NOT_RECORDED',
      evidenceReference: '',
      projectedEntryCount: 0,
      safeCandidateEntryCount: 0,
      suppliedEntryCount: 0,
      suppliedCategories: [],
      sharedContribution: false,
      projectionDisposition: 'NOT_RECORDED',
      admissionDisposition: 'NOT_APPLICABLE',
      status: OUTCOME_STUDIO_EXECUTION_EVIDENCE_STATUSES.NOT_RECORDED,
      checks: [
        {
          key: 'BOUNDARY_DECLARED',
          status: OUTCOME_STUDIO_EXECUTION_EVIDENCE_STATUSES.PASSED,
          message: 'The governed binding declares a non-provider execution boundary.',
        },
        {
          key: 'BOUNDARY_RECEIPT_RECORDED',
          status: OUTCOME_STUDIO_EXECUTION_EVIDENCE_STATUSES.NOT_RECORDED,
          message: 'The boundary executor has not yet recorded a receipt for this exact version.',
        },
      ],
    })
    return receipts
  }, [])
}

const finalizeLiveExecutionEvidence = ({
  executionEvidence,
  executionId,
  providerResult,
  requestFingerprint,
} = {}) => {
  if (!executionEvidence || typeof executionEvidence !== 'object') return null
  const passed = OUTCOME_STUDIO_EXECUTION_EVIDENCE_STATUSES.PASSED
  const notRecorded = OUTCOME_STUDIO_EXECUTION_EVIDENCE_STATUSES.NOT_RECORDED
  const responseSchema = providerResult?.metadata?.responseSchema || {}
  const providerCompletedAt = providerResult?.generatedAt || new Date()
  const packs = Array.isArray(executionEvidence.packs)
    ? executionEvidence.packs.map((pack) => {
        const providerContextSupplied = Number(pack?.suppliedEntryCount || 0) > 0
        const checks = Array.isArray(pack.checks)
          ? pack.checks.map((check) => {
            if (check.key !== 'PROVIDER_COMPLETED') return check
            return providerContextSupplied
              ? { ...check, status: passed, message: 'Provider returned a structured response for this assembled context.' }
              : {
                ...check,
                status: OUTCOME_STUDIO_EXECUTION_EVIDENCE_STATUSES.NOT_SUPPLIED,
                message: 'Provider completion is not recorded because no entry from this version was admitted to provider context.',
              }
          })
          : []
        return {
          ...pack,
          status: checks.length > 0 && checks.every((check) => check.status === passed)
            ? passed
            : pack.status,
          checks,
        }
      })
    : []
  return {
    ...executionEvidence,
    executionId,
    requestFingerprint,
    recordedAt: providerCompletedAt,
    packs,
    runtimeChecks: [
      {
        key: 'PROVIDER_REQUEST',
        status: passed,
        message: 'Provider request completed with recorded request identity and safe telemetry.',
        providerKey: normalizeText(providerResult?.provider?.providerKey),
        model: normalizeText(providerResult?.provider?.model),
        configurationVersion: normalizeText(providerResult?.metadata?.configurationVersion),
        requestId: normalizeText(providerResult?.metadata?.requestId),
        responseId: normalizeText(providerResult?.metadata?.responseId),
        latencyMs: Math.max(0, Number(providerResult?.metadata?.latencyMs || 0)),
      },
      {
        key: 'PROVIDER_RESPONSE_SCHEMA',
        status: responseSchema.strict === true && responseSchema.parsed === true ? passed : notRecorded,
        message: responseSchema.strict === true && responseSchema.parsed === true
          ? 'Strict provider response schema parsed successfully.'
          : 'Strict provider response-schema completion was not recorded.',
        schemaName: normalizeText(responseSchema.name),
        schemaVersion: normalizeText(responseSchema.version),
        strict: responseSchema.strict === true,
      },
      {
        key: 'OUTCOME_CONTENT_NORMALIZATION',
        status: notRecorded,
        message: 'Outcome normalization is recorded only after customer draft content is built.',
      },
      {
        key: 'OUTCOME_POST_VALIDATION',
        status: notRecorded,
        message: 'Outcome post-validation is recorded only after validators allow the draft.',
      },
    ],
  }
}

const buildProviderTruthContext = ({ payload = {}, truthContext = {} } = {}) => {
  const sourceTruthSummary = Array.isArray(truthContext.summary?.sourceTruthSummary)
    ? truthContext.summary.sourceTruthSummary.map((record, index) => ({
        order: index + 1,
        sectionKey: normalizeKey(record.sectionKey),
        label: normalizeText(record.label),
        summary: clampText(record.summary, 900),
        acceptedAt: record.acceptedAt || null,
        truthHash: normalizeText(record.truthHash),
      }))
    : []
  const outputEligibility = truthContext.summary?.outputEligibility || {}
  const graph = truthContext.summary?.graph || {}

  return {
    canExecute: truthContext.canExecute === true,
    // Provider execution is reached only after readiness has rejected blockers;
    // do not project internal blocker detail into the provider-facing envelope.
    blockers: [],
    summary: {
      acceptedTruthCount: Number.isFinite(Number(truthContext.summary?.acceptedTruthCount))
        ? Number(truthContext.summary.acceptedTruthCount)
        : sourceTruthSummary.length,
      requiredTruthCount: Number.isFinite(Number(truthContext.summary?.requiredTruthCount))
        ? Number(truthContext.summary.requiredTruthCount)
        : 0,
      missingRequiredTruthCount: Number.isFinite(Number(truthContext.summary?.missingRequiredTruthCount))
        ? Number(truthContext.summary.missingRequiredTruthCount)
        : 0,
      outputEligibility: {
        locked: outputEligibility.locked === true,
        published: outputEligibility.published === true,
        outputEligible: outputEligibility.outputEligible === true,
        canonicalOutputEligible: outputEligibility.canonicalOutputEligible === true,
        anchorEligible: outputEligibility.anchorEligible === true,
        intelligenceEligible: outputEligibility.intelligenceEligible === true,
        lockSnapshotHash: normalizeText(outputEligibility.lockSnapshotHash),
        replayAnchorHash: normalizeText(outputEligibility.replayAnchorHash),
      },
      graph: {
        available: graph.available === true,
        graphVersion: normalizeText(graph.graphVersion),
        graphHash: normalizeText(graph.graphHash),
        state: normalizeText(graph.state),
      },
      sourceTruthSummary,
    },
    projection: {
      status: 'PROJECTED',
      source: 'CERTIFIED_RUNTIME_TRUTH',
      projectionMode: 'CERTIFIED_TRUTH_SUMMARY',
      outputTypeKey: normalizeToken(payload.outputTypeKey),
      relevanceBasis: {
        outputTypeKey: normalizeToken(payload.outputTypeKey),
        selection: 'CERTIFIED_RUNTIME_TRUTH_SUMMARY',
        structuredRuntimeSectionMapApplied: false,
      },
      sectionCount: sourceTruthSummary.length,
      sections: sourceTruthSummary,
      safeguards: [
        'NO_RAW_RUNTIME_OBJECTS',
        'NO_RUNTIME_GRAPH_INTERNALS',
        'NO_DATABASE_IDS',
        'NO_RAW_SOURCE',
      ],
    },
  }
}

const buildProviderContext = ({
  knowledgeContext,
  payload,
  truthContext,
} = {}) => {
  const request = buildProviderRequestProjection(payload)
  const projectedTruthContext = buildProviderTruthContext({ payload: request, truthContext })
  const binding = knowledgeContext.binding || {}
  const isProviderContextPack = (pack) => (
    resolveKnowledgePackBoundary(pack) === KNOWLEDGE_PACK_BOUNDARIES.GENERATION_CONTEXT
  )
  const projectProviderPack = (pack) => ({
    ...pack,
    // Resolution has already enforced dependencies. Do not reveal references
    // to validation or system-only packs to the provider.
    dependencyReferences: [],
  })
  const projectProviderPackList = (packs) => (Array.isArray(packs)
    ? packs.filter(isProviderContextPack).map(projectProviderPack)
    : [])
  const providerContextPacks = binding.providerContextPacks?.length > 0
    ? projectProviderPackList(binding.providerContextPacks)
    : projectProviderPackList([
        ...(Array.isArray(binding.requiredPacks) ? binding.requiredPacks : []),
        ...(Array.isArray(binding.optionalPacks) ? binding.optionalPacks : []),
      ])
  const providerSelectedByLayer = Object.fromEntries(
    Object.entries(binding.selectedByLayer || {})
      .map(([layer, packs]) => [normalizeToken(layer), projectProviderPackList(packs)])
      .filter(([, packs]) => packs.length > 0),
  )
  const providerBinding = {
    status: binding.status,
    mode: binding.mode,
    contentVisible: false,
    packContentLoaded: false,
    requiredPacks: projectProviderPackList(binding.requiredPacks),
    optionalPacks: projectProviderPackList(binding.optionalPacks),
    providerContextPacks,
    selectedByLayer: providerSelectedByLayer,
    resolution: {
      status: binding.resolution?.status || binding.status,
      policyVersion: binding.resolution?.policyVersion || '',
      requestedOutputTypeKey: binding.resolution?.requestedOutputTypeKey || '',
      requestedStyleKey: binding.resolution?.requestedStyleKey || '',
    },
  }
  const providerKnowledgeContext = {
    manifest: knowledgeContext.manifest,
    binding: providerBinding,
    request,
  }

  return {
    assemblyMode: 'CERTIFIED_TRUTH_WITH_KNOWLEDGE_BINDING_METADATA',
    request,
    knowledgeContext: providerKnowledgeContext,
    truthContext: projectedTruthContext,
    certifiedTruthProjection: projectedTruthContext.projection,
    contentVisible: false,
    packContentLoaded: false,
    safeguards: [
      'KNOWLEDGE_PACK_CONTENT_NOT_EXPOSED',
      'RAW_PROVIDER_PROMPT_NOT_EXPOSED',
      'RAW_SOURCE_NOT_EXPOSED',
      'DATABASE_IDS_NOT_EXPOSED',
      'RUNTIME_GRAPH_INTERNALS_NOT_EXPOSED',
    ],
  }
}

const executeDeterministicProvider = ({
  knowledgeContext,
  payload,
  truthContext,
} = {}) => {
  const now = new Date()
  const sourceTruthSummary = truthContext.summary.sourceTruthSummary
  const sections = sourceTruthSummary.slice(0, 8).map((record, index) => ({
    order: index + 1,
    sectionKey: record.sectionKey,
    heading: record.label || record.sectionKey || `Certified Truth ${index + 1}`,
    evidenceHash: record.truthHash,
    narrative: record.summary,
  }))
  const outputTypeKey = normalizeToken(payload?.outputTypeKey)
  const title = `${outputTypeKey || 'GOVERNED_OUTPUT'} governed reasoning artefact`
  const markdown = [
    `# ${title}`,
    '',
    ...sections.flatMap((section) => [
      `## ${section.heading}`,
      section.narrative,
      '',
      `Evidence hash: ${section.evidenceHash}`,
      '',
    ]),
  ].join('\n').trim()

  return {
    generatedAt: now,
    provider: {
      providerKey: 'storylineos-deterministic-test-provider',
      providerMode: GRR_PROVIDER_MODES.DETERMINISTIC_TEST,
      model: 'deterministic-test-v1',
      liveProvider: false,
    },
    output: {
      title,
      outputTypeKey,
      sections,
      summary: sections.length > 0
        ? `Generated from ${sections.length} Certified Truth section(s) and ${knowledgeContext.binding.requiredPacks.length} required provider-context Knowledge Pack binding(s).`
        : 'Generated with no available Certified Truth sections.',
      markdown,
    },
    metadata: {
      tokenUsage: null,
      deterministic: true,
      noLiveProviderExecution: true,
    },
  }
}

const executeProvider = async ({
  deps = {},
  providerContext,
} = {}) => {
  const knowledgeContext = providerContext?.knowledgeContext || {}
  const payload = providerContext?.request || {}
  const truthContext = providerContext?.truthContext || {}

  if (typeof deps.providerAdapter === 'function') {
    return deps.providerAdapter({
      knowledgeContext,
      payload,
      truthContext,
      providerContext,
    })
  }

  const posture = resolveProviderPosture()
  if (posture.mode === GRR_PROVIDER_MODES.DETERMINISTIC_TEST) {
    return executeDeterministicProvider({ knowledgeContext, payload, truthContext })
  }

  throw createGrrError({
    status: 409,
    code: 'GRR_PROVIDER_UNAVAILABLE',
    message: 'Governed reasoning provider execution is not configured.',
    reason: GRR_ERROR_REASONS.PROVIDER_UNAVAILABLE,
  })
}

const buildRuntimeStateWrites = () => ({
  status: GRR_RUNTIME_STATE_WRITE_STATUSES.NOT_WRITTEN,
  reason: 'NO_REVIEWED_GRR_RUNTIME_PATH_V1',
  paths: [],
})

const serializeDocument = (document) => {
  if (!document) return null
  if (typeof document.toJSON === 'function') return document.toJSON()
  if (typeof document.toObject === 'function') return document.toObject()
  return cloneValue(document)
}

const UNSAFE_METADATA_KEYS = new Set([
  'content',
  'contentBase64',
  'customerId',
  'edgeId',
  'evidenceId',
  'frameworkPackageId',
  'hiddenPromptAssembly',
  'id',
  'nodeId',
  'packContent',
  'packId',
  'packageId',
  'prompt',
  'promptAssembly',
  'rawContent',
  'rawPackContent',
  'rawPrompt',
  'runtimeInstanceId',
  'sourceBundle',
  'sourceBundleId',
  'sourceId',
  'sourceText',
  'tenantId',
  'textContent',
  '_id',
  'acceptedBy',
  'activationId',
  'activationIds',
])

const scrubUnsafeMetadata = (value, seen = new WeakSet()) => {
  if (Array.isArray(value)) return value.map((entry) => scrubUnsafeMetadata(entry, seen))
  if (value instanceof Date) return value.toISOString()
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return {}
  seen.add(value)

  return Object.entries(value).reduce((acc, [key, entry]) => {
    if (UNSAFE_METADATA_KEYS.has(key) || UNSAFE_METADATA_KEYS.has(String(key).toLowerCase())) return acc
    acc[key] = scrubUnsafeMetadata(entry, seen)
    return acc
  }, {})
}

const projectExecution = (execution) => {
  const projected = serializeDocument(execution)
  if (!projected) return null

  return {
    ...projected,
    provider: scrubUnsafeMetadata(projected.provider || {}),
    knowledgeBinding: scrubUnsafeMetadata(projected.knowledgeBinding || {}),
    reasoningContext: scrubUnsafeMetadata(projected.reasoningContext || {}),
    executionEvidence: scrubUnsafeMetadata(projected.executionEvidence || {}),
  }
}

const projectArtifact = (artifact) => {
  const projected = serializeDocument(artifact)
  if (!projected) return null

  return {
    ...projected,
    safeJson: scrubUnsafeMetadata(projected.safeJson || {}),
    lineageSummary: scrubUnsafeMetadata(projected.lineageSummary || {}),
  }
}

const serializeExecution = (execution, artifact = null) => ({
  ...projectExecution(execution),
  artifact: artifact ? projectArtifact(artifact) : undefined,
})

const logGrrExecutionAudit = async ({
  auditRequest,
  dbSession = null,
  execution,
  runtimeInstance,
  deps = {},
} = {}) => {
  const logFn = deps.logAudit || auditService.logFromRequest
  return logFn(
    auditRequest,
    {
      actorUserId: execution.requestedBy,
      action: auditService.AUDIT_ACTIONS.GOVERNED_REASONING_EXECUTED,
      resourceType: auditService.RESOURCE_TYPES.GovernedReasoningExecution,
      resourceId: execution._id || execution.id,
      scope: {
        customerId: toIdString(runtimeInstance.customerId),
        tenantId: toIdString(runtimeInstance.tenantId),
      },
      diff: {
        operation: 'CREATE_GOVERNED_REASONING_EXECUTION',
        executionId: execution.executionId,
        artifactIds: execution.artifactIds,
        runtimeInstanceId: toIdString(runtimeInstance._id || runtimeInstance.id),
        runtimeInstanceKey: runtimeInstance.runtimeInstanceKey || '',
        providerMode: execution.providerMode,
        outputTypeKey: execution.outputTypeKey,
        knowledgeResolution: {
          status: normalizeToken(execution.knowledgeBinding?.status),
          policyVersion: normalizeText(execution.knowledgeBinding?.resolution?.policyVersion),
          resolvedCount: Number(execution.knowledgeBinding?.resolution?.resolvedCount || 0),
          activationIds: Array.isArray(execution.knowledgeBinding?.lineage?.activationIds)
            ? execution.knowledgeBinding.lineage.activationIds
            : [],
          versionIds: Array.isArray(execution.knowledgeBinding?.lineage?.versionIds)
            ? execution.knowledgeBinding.lineage.versionIds
            : [],
          contentHashes: Array.isArray(execution.knowledgeBinding?.lineage?.contentHashes)
            ? execution.knowledgeBinding.lineage.contentHashes
            : [],
        },
        runtimeStateWrites: execution.runtimeStateWrites,
      },
      display: {
        entityLabel: 'Governed Reasoning Runtime',
        summary: `Governed reasoning execution completed for ${execution.outputTypeKey}.`,
      },
    },
    {
      throwOnError: true,
      ...(dbSession ? { session: dbSession } : {}),
    },
  )
}

const buildGrrPersistenceFailure = ({
  cause,
  executionId,
  runtimeArtifactId,
} = {}) =>
  createRuntimeInstanceError({
    status: 500,
    code: 'GRR_PERSISTENCE_FAILED',
    message: 'Governed reasoning execution could not be persisted atomically.',
    reason: GRR_ERROR_REASONS.PERSISTENCE_FAILED,
    details: {
      executionId,
      runtimeArtifactId,
      cause: cause?.message || String(cause || ''),
    },
  })

const buildGrrAuditFailure = ({
  cause,
  executionId,
  runtimeArtifactId,
} = {}) =>
  createRuntimeInstanceError({
    status: 500,
    code: 'GRR_AUDIT_FAILED',
    message: 'Governed reasoning execution audit could not be persisted.',
    reason: GRR_ERROR_REASONS.AUDIT_PERSISTENCE_FAILED,
    details: {
      executionId,
      runtimeArtifactId,
      cause: cause?.message || String(cause || ''),
    },
  })

const findExistingIdempotentExecution = async ({
  idempotencyKey,
  providerDescriptor = null,
  requestFingerprint,
  runtimeInstance,
} = {}) => {
  const safeKey = normalizeText(idempotencyKey)
  if (!safeKey) return null

  const executionQuery = GovernedReasoningExecution.findOne({
    runtimeInstanceId: runtimeInstance._id || runtimeInstance.id,
    idempotencyKey: safeKey,
  })
  const existingExecution = typeof executionQuery?.lean === 'function'
    ? await executionQuery.lean()
    : await executionQuery
  if (!existingExecution) return null

  const existingFingerprint = normalizeText(existingExecution.requestFingerprint)
  if (!existingFingerprint || existingFingerprint !== requestFingerprint) {
    throw createGrrError({
      status: 409,
      code: 'GRR_IDEMPOTENCY_REQUEST_CONFLICT',
      message: 'The idempotency key is already associated with a different governed reasoning request.',
      reason: GRR_ERROR_REASONS.IDEMPOTENCY_REQUEST_CONFLICT,
      details: {
        fingerprintState: existingFingerprint ? 'MISMATCHED' : 'MISSING',
      },
    })
  }
  if (providerDescriptor) assertProviderEvidence({ provider: existingExecution.provider, providerDescriptor, conflict: true })

  const artifactQuery = GovernedRuntimeArtifact.findOne({
    executionId: existingExecution.executionId,
  })
  const existingArtifact = typeof artifactQuery?.lean === 'function'
    ? await artifactQuery.lean()
    : await artifactQuery
  if (!existingArtifact) {
    throw buildGrrPersistenceFailure({
      cause: new Error('Idempotent governed reasoning execution is missing its runtime artifact.'),
      executionId: existingExecution.executionId,
      runtimeArtifactId: '',
    })
  }

  return serializeExecution(existingExecution, existingArtifact)
}

const isIdempotencyDuplicateError = (err) => {
  if (Number(err?.code) !== 11000) return false
  if (err?.keyPattern?.idempotencyKey || err?.keyValue?.idempotencyKey) return true
  return normalizeText(err?.message).includes('runtimeInstanceId_1_idempotencyKey_1')
}

const persistGrrExecutionAndAudit = async ({
  artifact,
  auditRequest,
  dbSession = null,
  deps = {},
  execution,
  runtimeInstance,
} = {}) => {
  const saveOptions = dbSession ? { session: dbSession } : undefined
  await execution.save(saveOptions)
  await artifact.save(saveOptions)

  let audit
  try {
    audit = await logGrrExecutionAudit({
      auditRequest,
      dbSession,
      deps,
      execution,
      runtimeInstance,
    })
  } catch (err) {
    throw buildGrrAuditFailure({
      cause: err,
      executionId: execution.executionId,
      runtimeArtifactId: artifact.runtimeArtifactId,
    })
  }

  if (audit?._id || audit?.id) {
    execution.auditLogIds = [toIdString(audit._id || audit.id)]
    await execution.save(saveOptions)
  }
}

const buildManifestQuery = ({ payload = {}, runtimeInstance = {} }) => ({
  frameworkKey: normalizeToken(runtimeInstance.frameworkKey),
  runtimeType: normalizeToken(runtimeInstance.runtimeType),
  packageKey: normalizeKey(runtimeInstance.packageKey),
  packageVersion: normalizeText(runtimeInstance.packageVersion),
  outputKey: normalizeKey(payload.outputTypeKey),
  requestedOutputTypeKey: normalizeCapabilityKey(
    payload.requestedOutputTypeKey || payload.outputTypeKey,
  ),
  requestedStyleKey: normalizeLegacyCapabilitySelectorKey(payload.requestedStyleKey),
  audienceKeys: normalizeCapabilityKeys(payload.audienceKeys),
  industryKeys: normalizeCapabilityKeys(payload.industryKeys),
  languageKey: normalizeLegacyCapabilitySelectorKey(payload.languageKey),
  channelKey: normalizeLegacyCapabilitySelectorKey(payload.channelKey),
  workspaceType: normalizeToken(payload.workspaceType || 'PLATFORM'),
  contextCategories: Array.isArray(payload.contextCategories) ? payload.contextCategories : [],
  environmentKey: normalizeToken(payload.environmentKey || 'PRODUCTION'),
  customerId: toIdString(runtimeInstance.customerId),
  tenantId: toIdString(runtimeInstance.tenantId),
  runtimeInstanceId: toIdString(runtimeInstance._id || runtimeInstance.id),
})

const buildRequestFingerprint = ({ payload = {}, runtimeInstance = {} } = {}) => hashSafeValue({
  fingerprintVersion: 'GRR_REQUEST_V1',
  manifestQuery: buildManifestQuery({ payload, runtimeInstance }),
  providerRequest: buildProviderRequestProjection(payload),
})

const assertOutcomeStudioGenerationCompositionContract = ({
  composition,
  methodGuidance,
  errorIdentity,
} = {}) => {
  const outputBinding = composition?.outputBinding
  const ledger = composition?.businessFactLedger
  const validOutputBinding = isStrictPlainObject(outputBinding)
    && typeof outputBinding.outputTypeKey === 'string'
    && outputBinding.outputTypeKey.trim()
    && typeof outputBinding.outputSchemaKey === 'string'
    && outputBinding.outputSchemaKey.trim()
    && typeof outputBinding.styleKey === 'string'
    && outputBinding.styleKey.trim()
    && Array.isArray(outputBinding.outputTypeStructure)
    && outputBinding.outputTypeStructure.length > 0
    && Array.isArray(outputBinding.requiredSections)
    && outputBinding.requiredSections.length > 0
  if (!isStrictPlainObject(composition)
    || composition.contractVersion !== 'outcome-studio.evidence-to-composition.v1'
    || composition.status !== 'READY'
    || !isStrictPlainObject(ledger)
    || !Array.isArray(ledger.facts)
    || ledger.facts.length === 0
    || !validOutputBinding
    || !Array.isArray(methodGuidance)
    || methodGuidance.length === 0) {
    throw providerSafeContextBlocked(errorIdentity)
  }
}

export const createGovernedReasoningExecution = async ({
  actorUserId,
  auditRequest,
  deps = {},
  payload = {},
  runtimeInstanceId,
  scopes,
} = {}) => {
  const liveTest = resolveLiveTestConfiguration(deps)
  const providerContextErrorIdentity = liveTest.executionMode === 'LIVE_TEST'
    ? {
        safeContextPolicyKey: liveTest.providerDescriptor.safeContextPolicyKey,
        providerContextContractVersion: liveTest.providerContextContractVersion,
      }
    : undefined
  if (deps.requireGenerationContextConsumption !== undefined
    && typeof deps.requireGenerationContextConsumption !== 'boolean') {
    throw providerSafeContextBlocked(providerContextErrorIdentity)
  }
  const compositionSupplied = deps.evidenceComposition !== undefined
  if (deps.requireGenerationContextConsumption === true && !compositionSupplied) {
    throw providerSafeContextBlocked(providerContextErrorIdentity)
  }
  const usesGenerationContextConsumption = liveTest.executionMode === 'LIVE_TEST'
    && (compositionSupplied || deps.requireGenerationContextConsumption === true)
  if (usesGenerationContextConsumption) {
    assertOutcomeStudioGenerationCompositionContract({
      composition: deps.evidenceComposition,
      methodGuidance: deps.methodGuidance,
      errorIdentity: providerContextErrorIdentity,
    })
  }
  const idempotencyKey = normalizeText(payload.idempotencyKey)
  let effectivePayload = payload
  let safeRequest = null
  const authorizeCurrentLiveTest = async (stage) => assertLiveTestAuthorizationResult(
    await liveTest.authorizeLiveTest({ providerDescriptor: liveTest.providerDescriptor, stage }),
    liveTest.providerDescriptor,
  )
  if (liveTest.executionMode === 'LIVE_TEST') {
    await authorizeCurrentLiveTest('PRE_IDEMPOTENCY')
    assertLiveTestSelectorIdentity({
      errorIdentity: providerContextErrorIdentity,
      payload,
      providerInput: deps.providerInput,
    })
    try {
      safeRequest = assertSafeRequestResult(await liveTest.buildProviderSafeRequest({
        providerDescriptor: liveTest.providerDescriptor,
        providerInput: deps.providerInput,
      }), providerContextErrorIdentity)
      assertSafeRequestSelectorIdentity({
        errorIdentity: providerContextErrorIdentity,
        payload,
        safeRequest,
      })
    } catch (error) {
      if (error?.code === 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED') throw error
      throw providerSafeContextBlocked(providerContextErrorIdentity)
    }
    effectivePayload = buildLiveTestEffectivePayload({ payload, safeRequest })
  }
  const runtimeInstance = typeof deps.resolveRuntimeInstance === 'function'
    ? await deps.resolveRuntimeInstance({ runtimeInstanceId, scopes, permission: 'VMF_UPDATE' })
    : await resolveRuntimeInstance({
        runtimeInstanceId,
        scopes,
        permission: 'VMF_UPDATE',
      })
  let frameworkPackage
  let truthContext
  let manifest
  let binding
  let validatedGenerationContextConsumption = null
  if (usesGenerationContextConsumption) {
    frameworkPackage = typeof deps.resolveFrameworkPackage === 'function'
      ? await deps.resolveFrameworkPackage(runtimeInstance)
      : await resolveFrameworkPackage(runtimeInstance)
    truthContext = buildCertifiedTruthContext({ frameworkPackage, runtimeInstance })
    assertCertifiedTruthReady(truthContext)
    const manifestQuery = buildManifestQuery({ payload: effectivePayload, runtimeInstance })
    ;({ manifest, binding } = await resolveKnowledgeBinding({
      deps,
      manifestId: payload.manifestId,
      query: manifestQuery,
    }))
    assertKnowledgeBindingReady({ manifest, binding })
    try {
      validatedGenerationContextConsumption = assertOutcomeStudioGenerationContextConsumption({
        compositionPackage: deps.evidenceComposition,
        executionBindings: buildKnowledgeExecutionBindings(binding),
        generationContextConsumption: deps.generationContextConsumption,
        generationContextConsumptionFingerprint: deps.generationContextConsumptionFingerprint,
        knowledgeSelection: buildGovernedReasoningProviderSelection(binding),
        methodGuidance: deps.methodGuidance,
      })
    } catch (error) {
      if (error?.code === 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED') throw error
      throw providerSafeContextBlocked(providerContextErrorIdentity)
    }
  }
  let requestFingerprint
  if (liveTest.executionMode === 'LIVE_TEST') {
    requestFingerprint = buildLiveTestRequestFingerprint({
      payload: effectivePayload,
      providerContextBindingFingerprint: liveTest.providerContextBindingFingerprint,
      providerContextContractVersion: liveTest.providerContextContractVersion,
      providerDescriptor: liveTest.providerDescriptor,
      runtimeInstance,
      safeRequest,
      generationContextConsumptionFingerprint: validatedGenerationContextConsumption
        ?.generationContextConsumptionFingerprint,
    })
  } else {
    requestFingerprint = buildRequestFingerprint({ payload, runtimeInstance })
  }
  const existingExecution = await findExistingIdempotentExecution({
    idempotencyKey,
    providerDescriptor: liveTest.executionMode === 'LIVE_TEST' ? liveTest.providerDescriptor : null,
    requestFingerprint,
    runtimeInstance,
  })
  if (existingExecution) return existingExecution

  if (!usesGenerationContextConsumption) {
    frameworkPackage = typeof deps.resolveFrameworkPackage === 'function'
      ? await deps.resolveFrameworkPackage(runtimeInstance)
      : await resolveFrameworkPackage(runtimeInstance)
    truthContext = buildCertifiedTruthContext({ frameworkPackage, runtimeInstance })
    assertCertifiedTruthReady(truthContext)
    const manifestQuery = buildManifestQuery({ payload: effectivePayload, runtimeInstance })
    ;({ manifest, binding } = await resolveKnowledgeBinding({
      deps,
      manifestId: payload.manifestId,
      query: manifestQuery,
    }))
    assertKnowledgeBindingReady({ manifest, binding })
  }

  const knowledgeContext = buildKnowledgeContext({ manifest, binding, payload: effectivePayload })
  let providerContext
  let providerResult
  let executionEvidence = null
  if (liveTest.executionMode === 'LIVE_TEST') {
    try {
      providerContext = assertProviderContextResult(await liveTest.buildProviderSafeContext({
        providerDescriptor: liveTest.providerDescriptor,
        safeRequest,
        truthSource: buildTruthSource(truthContext),
        knowledgeSelection: buildGovernedReasoningProviderSelection(binding),
        executionBindings: buildKnowledgeExecutionBindings(binding),
        boundarySelection: buildGovernedReasoningBoundarySelection(binding),
        boundaryExecutionBindings: buildBoundaryExecutionBindings(binding),
        compositionPackage: deps.evidenceComposition,
        methodGuidance: deps.methodGuidance,
        governanceConstraints: deps.governanceConstraints,
        generationContextConsumption: validatedGenerationContextConsumption
          ?.generationContextConsumption,
        generationContextConsumptionFingerprint: validatedGenerationContextConsumption
          ?.generationContextConsumptionFingerprint,
        captureExecutionEvidence: (receipt) => {
          executionEvidence = receipt
        },
      }), safeRequest, {
        assertProviderSafeContext: liveTest.assertProviderSafeContext,
        errorIdentity: providerContextErrorIdentity,
        expectedContractVersion: liveTest.providerContextContractVersion,
      })
    } catch (error) {
      if (error?.code === 'GRR_PROVIDER_SAFE_CONTEXT_BLOCKED') throw error
      throw providerSafeContextBlocked(providerContextErrorIdentity)
    }
    await authorizeCurrentLiveTest('PRE_ADAPTER')
    providerResult = await liveTest.providerAdapter({ providerContext })
    assertProviderEvidence({ provider: providerResult?.provider, providerDescriptor: liveTest.providerDescriptor })
    assertStrictProviderResponseSchema(providerResult)
  } else {
    providerContext = buildProviderContext({ knowledgeContext, payload: effectivePayload, truthContext })
    providerResult = await executeProvider({ deps, providerContext })
  }
  const runtimeStateWrites = buildRuntimeStateWrites()
  const executionId = buildGrrId('grr_exec')
  const runtimeArtifactId = buildGrrId('grr_art')
  executionEvidence = liveTest.executionMode === 'LIVE_TEST'
    ? finalizeLiveExecutionEvidence({
        executionEvidence,
        executionId,
        providerResult,
        requestFingerprint,
      })
    : null
  if (executionEvidence) {
    const existingVersionIds = new Set(
      Array.isArray(executionEvidence.packs)
        ? executionEvidence.packs.map((pack) => normalizeText(pack?.versionId)).filter(Boolean)
        : [],
    )
    const boundaryReceipts = buildBoundaryReceiptPlaceholders(binding)
      .filter((pack) => !existingVersionIds.has(pack.versionId))
    executionEvidence = {
      ...executionEvidence,
      packs: [
        ...(Array.isArray(executionEvidence.packs) ? executionEvidence.packs : []),
        ...boundaryReceipts,
      ],
    }
  }
  const warnings = [
    ...(Array.isArray(providerResult?.warnings) ? providerResult.warnings : []),
    ...(liveTest.executionMode === 'LIVE_TEST' ? [] : ['KNOWLEDGE_PACK_CONTENT_NOT_EXPOSED_V1']),
  ]
  const limitations = [
    ...(Array.isArray(providerResult?.limitations) ? providerResult.limitations : []),
    'Runtime State writes are not performed until a governed GRR runtime path is reviewed.',
    ...(liveTest.executionMode === 'LIVE_TEST' ? [] : ['Deterministic provider output is non-production scaffolding unless replaced by a live provider adapter.']),
  ]
  const executionProviderEvidence = buildPersistedProviderEvidence({
    executionMode: liveTest.executionMode,
    providerDescriptor: liveTest.providerDescriptor,
    providerResult,
  })
  const artifactProviderEvidence = buildPersistedProviderEvidence({
    executionMode: liveTest.executionMode,
    providerDescriptor: liveTest.providerDescriptor,
    providerResult,
  })

  const execution = new GovernedReasoningExecution({
    executionId,
    ...getRuntimeScope(runtimeInstance),
    workspaceType: normalizeToken(payload.workspaceType || 'PLATFORM'),
    outputTypeKey: payload.outputTypeKey,
    requestedOutputTypeKey: normalizeCapabilityKey(
      payload.requestedOutputTypeKey || payload.outputTypeKey,
    ),
    executionIntent: effectivePayload.executionIntent || '',
    idempotencyKey,
    requestFingerprint,
    status: GRR_EXECUTION_STATUSES.COMPLETED,
    contractVersion: GRR_CONTRACT_VERSION,
    providerMode: executionProviderEvidence.providerMode || executionProviderEvidence.mode || GRR_PROVIDER_MODES.DETERMINISTIC_TEST,
    provider: executionProviderEvidence,
    knowledgeManifest: knowledgeContext.manifest,
    knowledgeBinding: knowledgeContext.binding,
    reasoningContext: liveTest.executionMode === 'LIVE_TEST' ? {
      assemblyMode: 'PROVIDER_SAFE_CONTEXT',
      request: safeRequest.businessRequest,
      safeguards: providerContext.safeguards,
      contentVisible: false,
      packContentLoaded: false,
    } : {
      assemblyMode: providerContext.assemblyMode,
      request: providerContext.request,
      certifiedTruthProjection: providerContext.certifiedTruthProjection,
      safeguards: providerContext.safeguards,
      contentVisible: false,
      packContentLoaded: false,
    },
    executionEvidence,
    certifiedTruth: liveTest.executionMode === 'LIVE_TEST' ? truthContext.summary : providerContext.truthContext.summary,
    runtimeStateWrites,
    artifactIds: [runtimeArtifactId],
    warnings,
    limitations,
    requestedBy: actorUserId,
    requestedAt: providerResult.generatedAt || new Date(),
    completedAt: providerResult.generatedAt || new Date(),
  })

  const artifact = new GovernedRuntimeArtifact({
    runtimeArtifactId,
    executionId,
    ...getRuntimeScope(runtimeInstance),
    outputTypeKey: payload.outputTypeKey,
    requestedOutputTypeKey: normalizeCapabilityKey(
      payload.requestedOutputTypeKey || payload.outputTypeKey,
    ),
    artifactType: 'GOVERNED_REASONING_OUTPUT',
    status: GRR_ARTIFACT_STATUSES.GENERATED,
    contractVersion: GRR_CONTRACT_VERSION,
    generatedOutput: providerResult.output || {},
    safeJson: {
      output: providerResult.output || {},
      provider: artifactProviderEvidence,
      metadata: providerResult.metadata || {},
    },
    markdown: providerResult.output?.markdown || '',
    lineageSummary: {
      executionId,
      manifest: knowledgeContext.manifest,
      knowledgeBinding: {
        requiredPackCount: knowledgeContext.binding.requiredPacks.length,
        optionalPackCount: knowledgeContext.binding.optionalPacks.length,
        validationPackCount: knowledgeContext.binding.validationPacks.length,
        status: knowledgeContext.binding.status,
        policyVersion: knowledgeContext.binding.resolution.policyVersion,
        lineage: knowledgeContext.binding.lineage,
      },
      certifiedTruth: {
        acceptedTruthCount: truthContext.summary.acceptedTruthCount,
        requiredTruthCount: truthContext.summary.requiredTruthCount,
        graphHash: truthContext.summary.graph.graphHash,
        lockSnapshotHash: truthContext.summary.outputEligibility.lockSnapshotHash,
      },
    },
    certification: {
      certifiedTruthOnly: true,
      runtimeArtifactIsCertifiedTruth: false,
      requiresSeparateCertificationBeforeTruthReuse: true,
    },
    warnings,
    limitations,
    generatedBy: actorUserId,
    generatedAt: providerResult.generatedAt || new Date(),
  })

  if (canUseMongoTransaction()) {
    const dbSession = await mongoose.startSession()
    try {
      await dbSession.withTransaction(async () => {
        await persistGrrExecutionAndAudit({
          artifact,
          auditRequest,
          dbSession,
          deps,
          execution,
          runtimeInstance,
        })
      })
    } catch (err) {
      if (err?.code === 'GRR_AUDIT_FAILED') throw err
      if (isIdempotencyDuplicateError(err)) {
        if (liveTest.executionMode === 'LIVE_TEST') {
          await authorizeCurrentLiveTest('PRE_RACE_WINNER_RETURN')
        }
        const winner = await findExistingIdempotentExecution({
          idempotencyKey,
          providerDescriptor: liveTest.executionMode === 'LIVE_TEST' ? liveTest.providerDescriptor : null,
          requestFingerprint,
          runtimeInstance,
        })
        if (winner) return winner
      }
      throw buildGrrPersistenceFailure({
        cause: err,
        executionId,
        runtimeArtifactId,
      })
    } finally {
      await dbSession.endSession()
    }
  } else {
    try {
      await persistGrrExecutionAndAudit({
        artifact,
        auditRequest,
        deps,
        execution,
        runtimeInstance,
      })
    } catch (err) {
      await GovernedRuntimeArtifact.deleteOne({ runtimeArtifactId })
      await GovernedReasoningExecution.deleteOne({ executionId })
      if (err?.code === 'GRR_AUDIT_FAILED') throw err
      if (isIdempotencyDuplicateError(err)) {
        if (liveTest.executionMode === 'LIVE_TEST') {
          await authorizeCurrentLiveTest('PRE_RACE_WINNER_RETURN')
        }
        const winner = await findExistingIdempotentExecution({
          idempotencyKey,
          providerDescriptor: liveTest.executionMode === 'LIVE_TEST' ? liveTest.providerDescriptor : null,
          requestFingerprint,
          runtimeInstance,
        })
        if (winner) return winner
      }
      throw buildGrrPersistenceFailure({
        cause: err,
        executionId,
        runtimeArtifactId,
      })
    }
  }

  return serializeExecution(execution, artifact)
}

export const getGovernedReasoningExecution = async ({
  executionId,
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = await resolveRuntimeInstance({
    runtimeInstanceId,
    scopes,
    permission: 'VMF_VIEW',
  })

  const execution = await GovernedReasoningExecution.findOne({
    executionId,
    runtimeInstanceId: runtimeInstance._id || runtimeInstance.id,
  }).lean()

  if (!execution) {
    throw createGrrError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Governed reasoning execution was not found.',
      reason: GRR_ERROR_REASONS.EXECUTION_NOT_FOUND,
      details: { executionId },
    })
  }

  const artifact = await GovernedRuntimeArtifact.findOne({
    executionId,
    runtimeInstanceId: runtimeInstance._id || runtimeInstance.id,
  }).lean()

  return serializeExecution(execution, artifact)
}
