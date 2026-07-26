import { createHash } from 'node:crypto'
import { resolveOutcomeStudioKnowledgePackBinding } from './outcomeKnowledgePackRegistryService.js'
import { resolveOutcomeRendererCapability } from './outcomeRendererCapabilityRegistryService.js'

export const OUTCOME_STUDIO_KNOWLEDGE_CONTEXT_VERSION = 'oes-004-resolved-knowledge-context.v1'

const READY_STATUSES = new Set(['READY', 'READY_WITH_GAPS'])
const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeCapabilityKey = (value) => normalizeText(value).toLowerCase()

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
  },
  reasoningBinding: null,
  reasoningResolution: null,
})

export const resolveOutcomeStudioKnowledgeContext = async ({ query = {} } = {}) => {
  const requestedOutputTypeKey = normalizeCapabilityKey(query.requestedOutputTypeKey)
  if (!requestedOutputTypeKey) {
    return blockedContextResult({
      reason: 'DELIVERABLE_TYPE_REQUIRED',
    })
  }

  const resolution = await resolveOutcomeStudioKnowledgePackBinding({
    query: {
      ...query,
      requestedOutputTypeKey,
    },
  })
  const { binding } = resolution
  const status = normalizeToken(binding?.status)
  if (!READY_STATUSES.has(status)) {
    return blockedContextResult({
      binding,
      reason: status === 'AMBIGUOUS'
        ? 'DELIVERABLE_GUIDANCE_AMBIGUOUS'
        : 'DELIVERABLE_GUIDANCE_BLOCKED',
      requestedOutputTypeKey,
      status: status || 'BLOCKED',
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
    return blockedContextResult({
      binding,
      reason: 'DELIVERABLE_BINDING_INCOMPLETE',
      requestedOutputTypeKey,
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
  }

  return {
    context,
    reasoningBinding: binding,
    reasoningResolution: resolution,
  }
}

export const projectOutcomeStudioDeliverableDiscovery = (binding = {}) => {
  const discovered = Array.isArray(binding.availableOutputTypes)
    ? binding.availableOutputTypes
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
