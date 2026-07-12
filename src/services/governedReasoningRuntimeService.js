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
  assertCustomerTenantContext,
  assertFeatureEntitlement,
  assertRuntimePermission,
  createRuntimeInstanceError,
  getFeatureForRuntimeType,
  toIdString,
} from './runtimeInstanceService.js'
import {
  previewKnowledgePackManifestResolution,
  resolveDefaultOutcomeStudioKnowledgePackBinding,
} from './knowledgePackManifestService.js'
import {
  buildRuntimeIntelligenceGraphProjection,
  buildRuntimeIntelligenceGraphQueryProjection,
} from './runtimeIntelligenceGraphService.js'
import auditService from './auditService.js'

export const GRR_ERROR_REASONS = Object.freeze({
  RUNTIME_NOT_FOUND: 'RUNTIME_NOT_FOUND',
  CERTIFIED_TRUTH_MISSING: 'CERTIFIED_TRUTH_MISSING',
  KNOWLEDGE_BINDING_BLOCKED: 'KNOWLEDGE_BINDING_BLOCKED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  AUDIT_PERSISTENCE_FAILED: 'AUDIT_PERSISTENCE_FAILED',
  EXECUTION_NOT_FOUND: 'EXECUTION_NOT_FOUND',
})

const normalizeToken = (value) => String(value || '').trim().toUpperCase()
const normalizeKey = (value) => String(value || '').trim().toLowerCase()
const normalizeText = (value) => String(value ?? '').trim()
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
    : resolveDefaultOutcomeStudioKnowledgePackBinding({ query })
}

const assertKnowledgeBindingReady = ({ manifest, binding }) => {
  if (!binding || normalizeToken(binding.status) === 'BLOCKED') {
    throw createGrrError({
      status: 409,
      code: 'GRR_KNOWLEDGE_BINDING_BLOCKED',
      message: 'Knowledge Manifest resolution is blocked.',
      reason: GRR_ERROR_REASONS.KNOWLEDGE_BINDING_BLOCKED,
      details: {
        manifestId: manifest?.manifestId || null,
        status: binding?.status || null,
        blockers: binding?.blockers || binding?.resolution?.blockers || [],
      },
    })
  }
}

const sanitizePack = (pack = {}) => ({
  packType: normalizeToken(pack.packType),
  packKey: normalizeKey(pack.packKey),
  versionId: normalizeText(pack.versionId),
  semanticVersion: normalizeText(pack.semanticVersion),
  contentHash: normalizeText(pack.contentHash),
  label: normalizeText(pack.label),
  purposeCategory: normalizeToken(pack.purposeCategory),
  executionMode: normalizeToken(pack.executionMode),
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
  requiredCount: Number.isFinite(Number(resolution.requiredCount)) ? Number(resolution.requiredCount) : 0,
  optionalCount: Number.isFinite(Number(resolution.optionalCount)) ? Number(resolution.optionalCount) : 0,
  validationCount: Number.isFinite(Number(resolution.validationCount)) ? Number(resolution.validationCount) : 0,
  blockedCount: Number.isFinite(Number(resolution.blockedCount)) ? Number(resolution.blockedCount) : 0,
  requestedContextCategories: Array.isArray(resolution.requestedContextCategories)
    ? resolution.requestedContextCategories.map(normalizeToken).filter(Boolean)
    : [],
})

const buildKnowledgeContext = ({ manifest, binding, payload }) => ({
  manifest: {
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
    dependencyGraph: sanitizeDependencyGraph(binding?.dependencyGraph || {}),
    resolution: sanitizeKnowledgeResolution(binding?.resolution || {}),
  },
  request: {
    outputTypeKey: normalizeToken(payload?.outputTypeKey),
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
  workspaceType: normalizeToken(payload.workspaceType || 'PLATFORM'),
  environmentKey: normalizeToken(payload.environmentKey || 'PRODUCTION'),
  manifestId: normalizeText(payload.manifestId),
  contextCategories: Array.isArray(payload.contextCategories)
    ? payload.contextCategories.map(normalizeToken).filter(Boolean)
    : [],
  executionIntent: clampText(payload.executionIntent, 2000),
})

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

  return {
    assemblyMode: 'CERTIFIED_TRUTH_WITH_KNOWLEDGE_BINDING_METADATA',
    request,
    knowledgeContext: {
      ...knowledgeContext,
      request,
    },
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
        ? `Generated from ${sections.length} Certified Truth section(s) and ${knowledgeContext.binding.requiredPacks.length} required Knowledge Pack binding(s).`
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
])

const scrubUnsafeMetadata = (value, seen = new WeakSet()) => {
  if (Array.isArray(value)) return value.map((entry) => scrubUnsafeMetadata(entry, seen))
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
  contextCategories: Array.isArray(payload.contextCategories) ? payload.contextCategories : [],
  environmentKey: normalizeToken(payload.environmentKey || 'PRODUCTION'),
  customerId: toIdString(runtimeInstance.customerId),
  tenantId: toIdString(runtimeInstance.tenantId),
  runtimeInstanceId: toIdString(runtimeInstance._id || runtimeInstance.id),
})

export const createGovernedReasoningExecution = async ({
  actorUserId,
  auditRequest,
  deps = {},
  payload = {},
  runtimeInstanceId,
  scopes,
} = {}) => {
  const runtimeInstance = typeof deps.resolveRuntimeInstance === 'function'
    ? await deps.resolveRuntimeInstance({ runtimeInstanceId, scopes, permission: 'VMF_UPDATE' })
    : await resolveRuntimeInstance({
        runtimeInstanceId,
        scopes,
        permission: 'VMF_UPDATE',
      })
  const frameworkPackage = typeof deps.resolveFrameworkPackage === 'function'
    ? await deps.resolveFrameworkPackage(runtimeInstance)
    : await resolveFrameworkPackage(runtimeInstance)
  const idempotencyKey = normalizeText(payload.idempotencyKey)
  const existingExecution = await findExistingIdempotentExecution({
    idempotencyKey,
    runtimeInstance,
  })
  if (existingExecution) return existingExecution

  const truthContext = buildCertifiedTruthContext({ frameworkPackage, runtimeInstance })
  assertCertifiedTruthReady(truthContext)

  const manifestQuery = buildManifestQuery({ payload, runtimeInstance })
  const { manifest, binding } = await resolveKnowledgeBinding({
    deps,
    manifestId: payload.manifestId,
    query: manifestQuery,
  })
  assertKnowledgeBindingReady({ manifest, binding })

  const knowledgeContext = buildKnowledgeContext({ manifest, binding, payload })
  const providerContext = buildProviderContext({ knowledgeContext, payload, truthContext })
  const providerResult = await executeProvider({
    deps,
    providerContext,
  })
  const runtimeStateWrites = buildRuntimeStateWrites()
  const executionId = buildGrrId('grr_exec')
  const runtimeArtifactId = buildGrrId('grr_art')
  const warnings = [
    ...(Array.isArray(providerResult?.warnings) ? providerResult.warnings : []),
    'KNOWLEDGE_PACK_CONTENT_NOT_EXPOSED_V1',
  ]
  const limitations = [
    ...(Array.isArray(providerResult?.limitations) ? providerResult.limitations : []),
    'Runtime State writes are not performed until a governed GRR runtime path is reviewed.',
    'Deterministic provider output is non-production scaffolding unless replaced by a live provider adapter.',
  ]

  const execution = new GovernedReasoningExecution({
    executionId,
    ...getRuntimeScope(runtimeInstance),
    workspaceType: normalizeToken(payload.workspaceType || 'PLATFORM'),
    outputTypeKey: payload.outputTypeKey,
    executionIntent: payload.executionIntent || '',
    idempotencyKey,
    status: GRR_EXECUTION_STATUSES.COMPLETED,
    contractVersion: GRR_CONTRACT_VERSION,
    providerMode: providerResult.provider?.providerMode || providerResult.provider?.mode || GRR_PROVIDER_MODES.DETERMINISTIC_TEST,
    provider: providerResult.provider || {},
    knowledgeManifest: knowledgeContext.manifest,
    knowledgeBinding: knowledgeContext.binding,
    reasoningContext: {
      assemblyMode: providerContext.assemblyMode,
      request: providerContext.request,
      certifiedTruthProjection: providerContext.certifiedTruthProjection,
      safeguards: providerContext.safeguards,
      contentVisible: false,
      packContentLoaded: false,
    },
    certifiedTruth: providerContext.truthContext.summary,
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
    artifactType: 'GOVERNED_REASONING_OUTPUT',
    status: GRR_ARTIFACT_STATUSES.GENERATED,
    contractVersion: GRR_CONTRACT_VERSION,
    generatedOutput: providerResult.output || {},
    safeJson: {
      output: providerResult.output || {},
      provider: providerResult.provider || {},
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
      },
      certifiedTruth: {
        acceptedTruthCount: providerContext.truthContext.summary.acceptedTruthCount,
        requiredTruthCount: providerContext.truthContext.summary.requiredTruthCount,
        graphHash: providerContext.truthContext.summary.graph.graphHash,
        lockSnapshotHash: providerContext.truthContext.summary.outputEligibility.lockSnapshotHash,
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
