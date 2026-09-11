import { createHash } from 'node:crypto'
import {
  OUTCOME_STUDIO_BLOCKER_CODES,
  OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES,
} from '../constants/runtimeOutcomeStudio.js'
import { resolveOutcomeStudioKnowledgePackBinding } from './outcomeKnowledgePackRegistryService.js'
import { resolveOutcomeRendererCapability } from './outcomeRendererCapabilityRegistryService.js'

export const OUTCOME_STUDIO_KNOWLEDGE_CONTEXT_VERSION = 'oes-004-resolved-knowledge-context.v1'

const READY_STATUSES = new Set(['READY', 'READY_WITH_GAPS'])
const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeCapabilityKey = (value) => normalizeText(value).toLowerCase()

const buildBoundedContextReceipt = ({
  policy,
  resolution,
  rendererResultCount = null,
} = {}) => {
  if (!policy) return null
  const dependencies = Array.isArray(resolution?.boundedReadReceipt?.dependencies)
    ? resolution.boundedReadReceipt.dependencies.map((dependency) => ({ ...dependency }))
    : []
  if (rendererResultCount !== null) {
    dependencies.push({
      dependencyKey: 'renderer_capability_registry',
      commandKey: 'HANDOFF_RENDERER_CAPABILITY_READ',
      maxTimeMS: policy.maxTimeMS,
      limit: 1,
      sortKeys: [],
      projectionFields: ['in_process_renderer_capability'],
      resultCount: rendererResultCount,
      overflowed: false,
    })
  }
  return {
    policyVersion: policy.policyVersion,
    dependencies,
    providerAccessed: false,
    networkAccessed: false,
    fullRuntimeFetched: false,
  }
}

const formatCapabilityLabel = (value, fallback = '') => {
  const label = normalizeText(value).replace(/\s+output\s+type$/i, '')
  if (label) return label
  return normalizeCapabilityKey(fallback)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

const selectSingleLayer = (binding, layer) => {
  const entries = Array.isArray(binding?.selectedByLayer?.[layer])
    ? binding.selectedByLayer[layer]
    : []
  return entries.length === 1 ? entries[0] : null
}

const projectLayerDescriptor = (entry, fallbackKey = '') => ({
  key: normalizeCapabilityKey(entry?.capabilityKey || fallbackKey),
  label: normalizeText(entry?.label),
  version: normalizeText(entry?.semanticVersion),
})

const projectLineage = (binding = {}) => ({
  resolvedAt: normalizeText(binding.lineage?.resolvedAt || binding.resolution?.lineage?.resolvedAt),
  contentHashes: Array.isArray(binding.lineage?.contentHashes)
    ? binding.lineage.contentHashes.map(normalizeText).filter(Boolean)
    : [],
})

const projectSelector = (selector = {}) => ({
  ...(normalizeToken(selector.knowledgeLayer)
    ? { knowledgeLayer: normalizeToken(selector.knowledgeLayer) }
    : {}),
  ...(normalizeToken(selector.packType)
    ? { packType: normalizeToken(selector.packType) }
    : {}),
  ...(normalizeCapabilityKey(selector.packKey)
    ? { packKey: normalizeCapabilityKey(selector.packKey) }
    : {}),
  ...(normalizeCapabilityKey(selector.capabilityKey)
    ? { capabilityKey: normalizeCapabilityKey(selector.capabilityKey) }
    : {}),
})

const projectResolutionEvidence = (binding = {}) => ({
  status: normalizeToken(binding.status || binding.resolution?.status),
  manifest: {
    id: normalizeText(binding.manifestId),
    key: normalizeText(binding.manifestKey),
    version: normalizeText(binding.manifestVersion),
  },
  policy: {
    key: normalizeText(binding.policyKey),
    version: normalizeText(binding.policyVersion || binding.resolution?.policyVersion),
  },
  missingDependencies: Array.isArray(binding.missingDependencies)
    ? binding.missingDependencies.slice(0, 24).map((entry) => ({
        reason: normalizeToken(entry?.reason),
        requirement: normalizeToken(entry?.requirement),
        requiredBy: normalizeText(entry?.requiredBy),
        selector: projectSelector(entry?.selector),
      }))
    : [],
  relationshipFailures: Array.isArray(binding.relationshipFailures)
    ? binding.relationshipFailures.slice(0, 24).map((entry) => ({
        code: normalizeToken(entry?.code),
        packType: normalizeToken(entry?.pack?.packType),
        packKey: normalizeCapabilityKey(entry?.pack?.packKey),
        relationshipType: normalizeToken(entry?.relationship?.relationshipType),
        targetPackType: normalizeToken(entry?.relationship?.targetPackType),
        targetKnowledgeLayer: normalizeToken(entry?.relationship?.targetKnowledgeLayer),
        targetPackKey: normalizeCapabilityKey(entry?.relationship?.targetPackKey),
        targetCapabilityKey: normalizeCapabilityKey(entry?.relationship?.targetCapabilityKey),
        targetKnowledgeAssetId: normalizeToken(entry?.relationship?.targetKnowledgeAssetId),
        observedState: normalizeText(entry?.observedState),
      }))
    : [],
  ambiguousCandidates: Array.isArray(binding.ambiguousCandidates)
    ? binding.ambiguousCandidates.slice(0, 24).map((entry) => ({
        requiredBy: normalizeText(entry?.requiredBy),
        selector: projectSelector(entry?.selector),
        candidateCount: Array.isArray(entry?.candidates) ? entry.candidates.length : 0,
      }))
    : [],
})

const reasonForLayer = (layer) => ({
  OUTPUT_TYPE: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_UNRESOLVED,
  OUTPUT_SCHEMA: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_SCHEMA_UNRESOLVED,
  STYLE: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.STYLE_UNRESOLVED,
}[normalizeToken(layer)] || '')

const reasonForMandatoryPack = (packType) => ({
  ARL: OUTCOME_STUDIO_BLOCKER_CODES.ARL_PACK_MISSING,
  RL: OUTCOME_STUDIO_BLOCKER_CODES.RL_PACK_MISSING,
  OUTPUT_SCHEMA: OUTCOME_STUDIO_BLOCKER_CODES.OUTPUT_SCHEMA_PACK_MISSING,
  TRUTH_CERTIFICATION: OUTCOME_STUDIO_BLOCKER_CODES.TRUTH_CERTIFICATION_PACK_MISSING,
  OUTPUT_TYPE_DEFINITION: OUTCOME_STUDIO_BLOCKER_CODES.OUTPUT_TYPE_PACK_MISSING,
}[normalizeToken(packType)] || '')

const resolveBindingBlockerReason = (binding = {}, status = '') => {
  if (status === 'AMBIGUOUS') {
    const ambiguousLayer = binding.ambiguousCandidates?.[0]?.selector?.knowledgeLayer
    return reasonForLayer(ambiguousLayer)
      || OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_AMBIGUOUS
  }

  const missing = Array.isArray(binding.missingDependencies)
    ? binding.missingDependencies
    : []
  for (const entry of missing) {
    const layerReason = reasonForLayer(entry?.selector?.knowledgeLayer)
    if (layerReason) return layerReason
    const packReason = reasonForMandatoryPack(entry?.selector?.packType)
    if (packReason) return packReason
  }

  const failures = Array.isArray(binding.relationshipFailures)
    ? binding.relationshipFailures
    : []
  for (const entry of failures) {
    const layerReason = reasonForLayer(entry?.relationship?.targetKnowledgeLayer)
    if (layerReason) return layerReason
    const packReason = reasonForMandatoryPack(entry?.pack?.packType)
    if (packReason) return packReason
  }

  return OUTCOME_STUDIO_BLOCKER_CODES.KNOWLEDGE_PACK_BINDING_MISSING
}

const buildContextId = ({ binding, outputSchema, outputType, style }) => createHash('sha256')
  .update(JSON.stringify({
    policyVersion: normalizeText(binding?.resolution?.policyVersion || binding?.policyVersion),
    status: normalizeToken(binding?.status),
    outputType: outputType.key,
    outputSchema: outputSchema.key,
    style: style.key,
    lineage: projectLineage(binding),
  }))
  .digest('hex')

const blockedContextResult = ({
  binding = null,
  reason,
  requestedOutputTypeKey = '',
  status = 'BLOCKED',
  boundedReadReceipt = null,
} = {}) => ({
  context: {
    contractVersion: OUTCOME_STUDIO_KNOWLEDGE_CONTEXT_VERSION,
    contextId: '',
    status: normalizeToken(status || 'BLOCKED'),
    available: false,
    blockerReason: normalizeToken(reason || 'DELIVERABLE_CONTEXT_UNAVAILABLE'),
    requestedOutputTypeKey: normalizeCapabilityKey(requestedOutputTypeKey),
    outputType: null,
    outputSchema: null,
    style: null,
    renderer: null,
    warnings: [],
    lineage: projectLineage(binding || {}),
    resolutionEvidence: projectResolutionEvidence(binding || {}),
  },
  reasoningBinding: null,
  reasoningResolution: null,
  ...(boundedReadReceipt ? { boundedReadReceipt } : {}),
})

export const resolveOutcomeStudioKnowledgeContext = async ({
  query = {},
  boundedReadPolicy = null,
} = {}) => {
  const requestedOutputTypeKey = normalizeCapabilityKey(query.requestedOutputTypeKey)
  if (!requestedOutputTypeKey) {
    return blockedContextResult({
      reason: OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_UNRESOLVED,
    })
  }

  const resolution = await resolveOutcomeStudioKnowledgePackBinding({
    query: {
      ...query,
      requestedOutputTypeKey,
    },
    boundedReadPolicy,
  })
  const { binding } = resolution
  const boundedReceipt = buildBoundedContextReceipt({
    policy: boundedReadPolicy,
    resolution,
  })
  const status = normalizeToken(binding?.status)
  if (!READY_STATUSES.has(status)) {
    return blockedContextResult({
      binding,
      reason: status === 'AMBIGUOUS'
        ? OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_AMBIGUOUS
        : resolveBindingBlockerReason(binding, status || 'BLOCKED'),
      requestedOutputTypeKey,
      status: status || 'BLOCKED',
      boundedReadReceipt: boundedReceipt,
    })
  }

  const selectedOutputType = selectSingleLayer(binding, 'OUTPUT_TYPE')
  const selectedOutputSchema = selectSingleLayer(binding, 'OUTPUT_SCHEMA')
  const selectedStyle = selectSingleLayer(binding, 'STYLE')
  const outputType = projectLayerDescriptor(selectedOutputType, requestedOutputTypeKey)
  const outputSchema = projectLayerDescriptor(selectedOutputSchema)
  const style = projectLayerDescriptor(selectedStyle)

  if (
    !selectedOutputType
    || outputType.key !== requestedOutputTypeKey
    || !outputSchema.key
    || !style.key
  ) {
    const reason = !selectedOutputType || outputType.key !== requestedOutputTypeKey
      ? OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_TYPE_UNRESOLVED
      : !outputSchema.key
        ? OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.OUTPUT_SCHEMA_UNRESOLVED
        : !style.key
          ? OUTCOME_STUDIO_REQUEST_RESOLUTION_BLOCKER_CODES.STYLE_UNRESOLVED
          : OUTCOME_STUDIO_BLOCKER_CODES.KNOWLEDGE_PACK_BINDING_MISSING
    return blockedContextResult({
      binding,
      reason,
      requestedOutputTypeKey,
      boundedReadReceipt: boundedReceipt,
    })
  }

  const rendererResolution = resolveOutcomeRendererCapability({
    outputTypeKey: outputType.key,
    outputSchemaKey: outputSchema.key,
    styleKey: style.key,
  })
  if (rendererResolution.status !== 'SUPPORTED') {
    return blockedContextResult({
      binding,
      reason: rendererResolution.reason,
      requestedOutputTypeKey,
      boundedReadReceipt: buildBoundedContextReceipt({
        policy: boundedReadPolicy,
        resolution,
        rendererResultCount: 0,
      }),
    })
  }

  const renderer = rendererResolution.capability
  const lineage = projectLineage(binding)
  const context = {
    contractVersion: OUTCOME_STUDIO_KNOWLEDGE_CONTEXT_VERSION,
    contextId: buildContextId({ binding, outputSchema, outputType, style }),
    status,
    available: true,
    blockerReason: '',
    requestedOutputTypeKey,
    outputType: {
      ...outputType,
      label: formatCapabilityLabel(outputType.label, outputType.key),
    },
    outputSchema,
    style,
    renderer: {
      capabilityKey: renderer.capabilityKey,
      capabilityVersion: renderer.capabilityVersion,
      formats: renderer.formats.map((entry) => ({ ...entry })),
    },
    warnings: Array.isArray(binding.warnings)
      ? binding.warnings.map((warning) => normalizeText(warning?.message || warning)).filter(Boolean)
      : [],
    lineage,
    resolutionEvidence: projectResolutionEvidence(binding),
  }

  return {
    context,
    reasoningBinding: binding,
    reasoningResolution: resolution,
    ...(boundedReadPolicy
      ? { boundedReadReceipt: buildBoundedContextReceipt({
          policy: boundedReadPolicy,
          resolution,
          rendererResultCount: 1,
        }) }
      : {}),
  }
}

export const projectOutcomeStudioDeliverableDiscovery = (binding = {}) => {
  const selectedByLayer = binding?.selectedByLayer || {}
  const selectedOutputType = Array.isArray(selectedByLayer.OUTPUT_TYPE)
    && selectedByLayer.OUTPUT_TYPE.length === 1
    ? selectedByLayer.OUTPUT_TYPE[0]
    : null
  const selectedOutputSchema = Array.isArray(selectedByLayer.OUTPUT_SCHEMA)
    && selectedByLayer.OUTPUT_SCHEMA.length === 1
    ? selectedByLayer.OUTPUT_SCHEMA[0]
    : null
  const selectedStyle = Array.isArray(selectedByLayer.STYLE)
    && selectedByLayer.STYLE.length === 1
    ? selectedByLayer.STYLE[0]
    : null
  const discovered = Array.isArray(binding.availableOutputTypes)
    && binding.availableOutputTypes.length > 0
    ? binding.availableOutputTypes
    : selectedOutputType && selectedOutputSchema && selectedStyle
      ? [{
        capabilityKey: selectedOutputType.capabilityKey,
        status: normalizeToken(selectedOutputType.status) === 'ACTIVE'
          ? 'READY'
          : selectedOutputType.status,
        outputType: selectedOutputType,
        outputSchema: selectedOutputSchema,
        style: selectedStyle,
      }]
      : []
  const available = []

  for (const entry of discovered) {
    if (!READY_STATUSES.has(normalizeToken(entry?.status))) continue
    const outputType = projectLayerDescriptor(entry.outputType, entry.capabilityKey)
    const outputSchema = projectLayerDescriptor(entry.outputSchema)
    const style = projectLayerDescriptor(entry.style)
    if (!outputType.key || !outputSchema.key || !style.key) continue

    const rendererResolution = resolveOutcomeRendererCapability({
      outputTypeKey: outputType.key,
      outputSchemaKey: outputSchema.key,
      styleKey: style.key,
    })
    if (rendererResolution.status !== 'SUPPORTED') continue

    available.push({
      key: outputType.key,
      label: formatCapabilityLabel(outputType.label, outputType.key),
      formats: rendererResolution.capability.formats.map((format) => ({ ...format })),
    })
  }

  available.sort((left, right) => left.label.localeCompare(right.label))
  const supportedFormats = [...new Set(
    available.flatMap((entry) => entry.formats.map((format) => format.format)),
  )]

  return {
    status: available.length > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
    available,
    availableCount: available.length,
    unavailableCount: Math.max(discovered.length - available.length, 0),
    supportedFormats,
  }
}
