import { createHash, randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import {
  OUTCOME_STUDIO_RENDER_FORMATS,
  OUTCOME_STUDIO_RENDER_OUTPUT_STATUSES,
} from '../constants/runtimeOutcomeStudio.js'
import { renderProfessionalDocumentCandidate } from './professionalDocumentCandidateRenderer.js'
import { renderProfessionalPdfCandidate } from './professionalPdfCandidateRenderer.js'
import { renderProfessionalPresentationCandidate } from './professionalPresentationCandidateRenderer.js'

export const OUTCOME_STUDIO_ASSET_RENDERING_CONTRACT_VERSION = 'outcome-studio.asset-rendering.v1'
export const OUTCOME_STUDIO_ASSET_RENDERING_REGISTRY_VERSION = 'outcome-studio.asset-rendering-registry.v1'

export const OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES = Object.freeze({
  INPUT_INVALID: 'OUTCOME_STUDIO_ASSET_RENDERING_INPUT_INVALID',
  VISUAL_UNSUPPORTED: 'OUTCOME_STUDIO_ASSET_RENDERING_VISUAL_UNSUPPORTED',
  RENDER_FAILED: 'OUTCOME_STUDIO_ASSET_RENDERING_RENDER_FAILED',
  RECEIPT_PERSISTENCE_FAILED: 'OUTCOME_STUDIO_ASSET_RENDERING_RECEIPT_PERSISTENCE_FAILED',
  RECEIPT_PERSISTENCE_REQUIRED: 'OUTCOME_STUDIO_ASSET_RENDERING_RECEIPT_PERSISTENCE_REQUIRED',
  CONTENT_CHANGED_REQUIRES_NEW_VERSION: 'OUTCOME_STUDIO_ASSET_RENDERING_CONTENT_CHANGED_REQUIRES_NEW_VERSION',
  VALIDATION_FAILED: 'OUTCOME_STUDIO_ASSET_RENDERING_VALIDATION_FAILED',
})

const ALLOWED_LAYOUT_PATTERNS = Object.freeze(['DOCUMENT', 'DECISION', 'PRESENTATION', 'SUMMARY'])
const DEFAULT_ALLOWED_COMPONENTS = Object.freeze(['HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'CALLOUT', 'METRIC'])
const RENDERABLE_ASSET_VERSION_STATUSES = new Set(['CURRENT', 'APPROVED'])
const ACCEPTED_EVIDENCE_STATUSES = new Set(['ACCEPTED', 'CURRENT', 'VERIFIED'])
const RESOLVED_PACK_STATUSES = new Set(['ACTIVE', 'CURRENT', 'RESOLVED'])

const createRenderingError = ({ code, reason, message, details = {}, cause = null }) => {
  const error = new Error(message)
  error.name = 'OutcomeStudioAssetRenderingError'
  error.code = code
  error.reason = reason
  error.details = {
    reason,
    contentIncludedInError: false,
    ...details,
  }
  if (cause) error.cause = cause
  return error
}

const failInput = (reason, details = {}) => {
  throw createRenderingError({
    code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.INPUT_INVALID,
    reason,
    message: 'The governed Outcome Studio asset is not renderable.',
    details,
  })
}

const normalizeText = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeId = (value) => {
  if (value && typeof value === 'object' && value.toString) return normalizeText(value.toString())
  return normalizeText(value)
}
const isPlainObject = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)),
)

const cloneJson = (value, reason = 'RENDER_MODEL_NOT_SERIALIZABLE') => {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (cause) {
    throw createRenderingError({
      code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.INPUT_INVALID,
      reason,
      message: 'The governed Outcome Studio asset could not be serialized safely.',
      cause,
    })
  }
}

const sortedJson = (value) => {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (isPlainObject(value)) {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = sortedJson(value[key])
      return result
    }, {})
  }
  return value
}

const sha256Json = (value) => `sha256:${createHash('sha256').update(JSON.stringify(sortedJson(value)), 'utf8').digest('hex')}`
const sha256Buffer = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const normalizeStringList = (value) => (
  Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : []
)

const normalizePackReceipt = (value, role) => {
  if (!isPlainObject(value)) failInput(`${role}_PACK_RECEIPT_MISSING`)
  const receipt = {
    packKey: normalizeText(value.packKey || value.key),
    versionId: normalizeId(value.versionId || value.id),
    version: normalizeText(value.version),
    contentHash: normalizeText(value.contentHash || value.contentSha256),
    status: normalizeToken(value.status),
  }
  if (!receipt.packKey || !receipt.versionId || !receipt.contentHash || !receipt.status) {
    failInput(`${role}_PACK_RECEIPT_INCOMPLETE`)
  }
  if (!RESOLVED_PACK_STATUSES.has(receipt.status)) {
    failInput(`${role}_PACK_RECEIPT_STATUS_NOT_RESOLVED`, { status: receipt.status })
  }
  if (role === 'VISUAL_SYSTEM') {
    receipt.allowedComponents = [...new Set(normalizeStringList(value.allowedComponents).map(normalizeToken))]
    if (!receipt.allowedComponents.length) failInput('VISUAL_SYSTEM_ALLOWED_COMPONENTS_MISSING')
  }
  if (isPlainObject(value.tokens)) receipt.tokens = cloneJson(value.tokens)
  return receipt
}

const normalizeEvidenceReferences = (value) => {
  if (!Array.isArray(value) || !value.length) failInput('EVIDENCE_REFERENCES_MISSING')
  return value.map((reference, index) => {
    if (!isPlainObject(reference)) failInput('EVIDENCE_REFERENCE_INVALID', { index })
    const normalized = {
      sourceId: normalizeId(reference.sourceId || reference.id),
      locator: normalizeText(reference.locator || reference.path),
      status: normalizeToken(reference.status),
    }
    if (!normalized.sourceId || !normalized.locator || !normalized.status) {
      failInput('EVIDENCE_REFERENCE_INCOMPLETE', { index })
    }
    if (!ACCEPTED_EVIDENCE_STATUSES.has(normalized.status)) {
      failInput('EVIDENCE_REFERENCE_STATUS_NOT_ACCEPTED', { index, status: normalized.status })
    }
    return normalized
  })
}

const normalizeBlocks = (section, sectionIndex) => {
  const sourceBlocks = Array.isArray(section.blocks) && section.blocks.length
    ? section.blocks
    : [{ type: 'PARAGRAPH', text: section.body || section.summary || section.narrative }]
  return sourceBlocks.map((block, blockIndex) => {
    if (!isPlainObject(block)) failInput('ASSET_BLOCK_INVALID', { sectionIndex, blockIndex })
    const type = normalizeToken(block.type || 'PARAGRAPH')
    const text = normalizeText(block.text || block.body || block.value || '')
    if (!text) failInput('ASSET_BLOCK_TEXT_MISSING', { sectionIndex, blockIndex })
    return {
      type,
      text,
      ...(normalizeText(block.label) ? { label: normalizeText(block.label) } : {}),
    }
  })
}

const parseMarkdownSections = (markdown) => {
  const lines = normalizeText(markdown).split('\n')
  const sections = []
  let current = null
  let paragraphLines = []

  const flushParagraph = () => {
    const text = normalizeText(paragraphLines.join('\n'))
    if (text) current?.blocks.push({ type: 'PARAGRAPH', text })
    paragraphLines = []
  }
  const ensureSection = () => {
    if (!current) {
      current = { key: 'content', label: 'Governed content', blocks: [] }
      sections.push(current)
    }
  }

  lines.forEach((line, index) => {
    const normalizedLine = line.trim()
    if (index === 0 && /^#\s+/.test(normalizedLine)) return
    const heading = normalizedLine.match(/^##\s+(.+)$/)
    if (heading) {
      flushParagraph()
      const label = normalizeText(heading[1])
      current = { key: `section-${sections.length + 1}`, label, blocks: [] }
      sections.push(current)
      return
    }
    ensureSection()
    if (/^[-*]\s+/.test(normalizedLine)) {
      flushParagraph()
      current.blocks.push({ type: 'LIST', text: normalizeText(normalizedLine.slice(2)) })
      return
    }
    if (!normalizedLine) {
      flushParagraph()
      return
    }
    paragraphLines.push(normalizedLine)
  })
  flushParagraph()

  const usableSections = sections.filter((section) => section.blocks.length)
  if (!usableSections.length) failInput('GOVERNED_CUSTOMER_CONTENT_MISSING')
  return usableSections
}

const normalizeSections = (customerContent) => {
  if (!Array.isArray(customerContent.sections) || !customerContent.sections.length) {
    const markdown = normalizeText(customerContent.markdown)
    if (!markdown) failInput('GOVERNED_CUSTOMER_CONTENT_MISSING')
    return { sections: parseMarkdownSections(markdown), sourceRepresentation: 'MARKDOWN_COMPATIBILITY' }
  }
  return {
    sections: customerContent.sections.map((section, index) => {
    if (!isPlainObject(section)) failInput('ASSET_SECTION_INVALID', { index })
    const key = normalizeText(section.key || `section-${index + 1}`)
    const label = normalizeText(section.label || section.title || key)
    if (!label) failInput('ASSET_SECTION_LABEL_MISSING', { index })
    return { key, label, blocks: normalizeBlocks(section, index) }
    }),
    sourceRepresentation: 'STRUCTURED_SECTIONS',
  }
}

const normalizeGovernanceMarkers = (assetVersion) => {
  const source = isPlainObject(assetVersion.governanceMarkers) ? assetVersion.governanceMarkers : {}
  const evidenceBoundary = normalizeText(source.evidenceBoundary || assetVersion.evidenceBoundary)
  const claimRestrictions = normalizeStringList(source.claimRestrictions || assetVersion.claimRestrictions)
  if (!evidenceBoundary) failInput('EVIDENCE_BOUNDARY_MISSING')
  if (!claimRestrictions.length) failInput('CLAIM_RESTRICTIONS_MISSING')
  return {
    evidenceBoundary,
    claimRestrictions,
    warnings: normalizeStringList(source.warnings || assetVersion.warnings),
    limitations: normalizeStringList(source.limitations || assetVersion.limitations),
  }
}

const normalizeRuntimeRevision = (assetVersion, runtimeRevision) => {
  const source = isPlainObject(runtimeRevision)
    ? runtimeRevision
    : (isPlainObject(assetVersion.runtimeRevision) ? assetVersion.runtimeRevision : {})
  const id = normalizeId(source.id || source.revisionId || assetVersion.runtimeRevisionId || assetVersion.lineageSummary?.runtimeRevisionId)
  const number = Number(source.number || source.revisionNumber || assetVersion.runtimeRevisionNumber || assetVersion.lineageSummary?.runtimeRevisionNumber || 0)
  if (!id) failInput('RUNTIME_REVISION_MISSING')
  return { id, ...(Number.isSafeInteger(number) && number > 0 ? { number } : {}) }
}

const normalizeVisualIntent = (assetVersion) => {
  const source = isPlainObject(assetVersion.visualIntent) ? assetVersion.visualIntent : {}
  const components = Array.isArray(source.components) ? source.components : []
  return {
    layoutPattern: normalizeToken(source.layoutPattern || assetVersion.layoutIntent?.layoutPattern || 'DOCUMENT'),
    components: components.map((component, index) => {
      if (!isPlainObject(component)) failInput('VISUAL_INTENT_COMPONENT_INVALID', { index })
      const type = normalizeToken(component.type)
      if (!type) failInput('VISUAL_INTENT_COMPONENT_TYPE_MISSING', { index })
      return {
        type,
        ...(normalizeText(component.fallbackType) ? { fallbackType: normalizeToken(component.fallbackType) } : {}),
      }
    }),
  }
}

const buildMarkdownFromSections = (title, sections) => [
  `# ${title}`,
  ...sections.flatMap((section) => [
    '',
    `## ${section.label}`,
    '',
    ...section.blocks.map((block) => block.type === 'LIST'
      ? `- ${block.text}`
      : block.text),
  ]),
].join('\n')

const assertSafeMarkdown = (markdown) => {
  if (!markdown || /<\/?[a-z][^>]*>/i.test(markdown) || /!\[[^\]]*\]\([^)]+\)/m.test(markdown)) {
    failInput('CUSTOMER_MARKDOWN_NOT_SAFE_FOR_RENDERING')
  }
  if (/\[[^\]]+\]\([^)]+\)/m.test(markdown)) failInput('CUSTOMER_MARKDOWN_LINKS_NOT_ALLOWED')
}

const toPlainAssetVersion = (assetVersion) => {
  if (assetVersion && typeof assetVersion.toObject === 'function') {
    return assetVersion.toObject({ depopulate: true })
  }
  if (isPlainObject(assetVersion)) return assetVersion
  failInput('ASSET_VERSION_INVALID')
}

const descriptorKey = (descriptor) => normalizeText(descriptor?.key || descriptor?.outputTypeKey)

const outputContractFromResolution = (resolution = {}) => {
  const source = isPlainObject(resolution) ? resolution : {}
  return {
    outputTypeKey: descriptorKey(source.outputType || source.selectedOutputType),
    outputSchemaKey: descriptorKey(source.outputSchema || source.selectedOutputSchema),
    styleKey: descriptorKey(source.style || source.selectedStyle),
    audience: normalizeText(source.audience || source.knowledgeContext?.audience),
  }
}

const truthEvidenceReferences = (truthSignature = {}) => {
  const evidence = isPlainObject(truthSignature.evidence) ? truthSignature.evidence : {}
  return evidence.references || evidence.items || evidence.sources || []
}

export const buildOutcomeStudioRenderableAssetFromPersistedVersion = ({
  assetVersion,
  runtimeRevision,
  outputContract,
  outputContractResolution,
  stylePackReceipt,
  visualSystemPackReceipt,
  evidenceReferences,
  governanceMarkers,
  visualIntent,
} = {}) => {
  const persistedVersion = toPlainAssetVersion(assetVersion)
  const contextBindings = isPlainObject(persistedVersion.contextBindings) ? persistedVersion.contextBindings : {}
  const truthSignature = isPlainObject(persistedVersion.truthSignature) ? persistedVersion.truthSignature : {}
  const resolution = outputContractResolution || contextBindings.outputContractResolution
  const resolvedContract = outputContract || outputContractFromResolution(resolution)
  const resolvedEvidenceReferences = evidenceReferences || truthEvidenceReferences(truthSignature)
  const resolvedGovernanceMarkers = governanceMarkers || {
    evidenceBoundary: persistedVersion.evidenceBoundary || truthSignature.evidenceBoundary,
    claimRestrictions: persistedVersion.claimRestrictions || truthSignature.claimRestrictions,
    warnings: persistedVersion.warnings,
    limitations: persistedVersion.limitations,
  }
  const resolvedVisualIntent = visualIntent || persistedVersion.visualIntent || persistedVersion.layoutIntent

  return buildOutcomeStudioRenderableAsset({
    assetVersion: {
      ...persistedVersion,
      evidenceReferences: resolvedEvidenceReferences,
      governanceMarkers: resolvedGovernanceMarkers,
      ...(resolvedVisualIntent ? { visualIntent: resolvedVisualIntent } : {}),
    },
    runtimeRevision,
    outputContract: resolvedContract,
    stylePackReceipt: stylePackReceipt || persistedVersion.packReceipts?.style,
    visualSystemPackReceipt: visualSystemPackReceipt || persistedVersion.packReceipts?.visualSystem,
  })
}

export const buildOutcomeStudioRenderableAsset = ({
  assetVersion = {},
  runtimeRevision,
  outputContract = {},
  stylePackReceipt,
  visualSystemPackReceipt,
} = {}) => {
  if (!isPlainObject(assetVersion)) failInput('ASSET_VERSION_INVALID')
  const assetId = normalizeText(assetVersion.outcomeAssetId || assetVersion.assetId)
  const assetVersionId = normalizeText(assetVersion.outcomeAssetVersionId || assetVersion.assetVersionId)
  const versionNumber = Number(assetVersion.versionNumber)
  const assetVersionStatus = normalizeToken(assetVersion.status)
  const customerContent = isPlainObject(assetVersion.customerContent) ? assetVersion.customerContent : null
  if (!assetId || !assetVersionId || !Number.isSafeInteger(versionNumber) || versionNumber < 1) {
    failInput('ASSET_VERSION_IDENTITY_INVALID')
  }
  if (!RENDERABLE_ASSET_VERSION_STATUSES.has(assetVersionStatus)) {
    failInput('ASSET_VERSION_STATUS_NOT_RENDERABLE', { status: assetVersionStatus })
  }
  if (!customerContent) failInput('GOVERNED_CUSTOMER_CONTENT_MISSING')

  const title = normalizeText(assetVersion.title || assetVersion.outputTypeLabel)
  if (!title) failInput('ASSET_TITLE_MISSING')
  const tenantId = normalizeId(assetVersion.tenantId)
  const customerId = normalizeId(assetVersion.customerId)
  const runtimeInstanceId = normalizeId(assetVersion.runtimeInstanceId)
  if (!tenantId || !customerId || !runtimeInstanceId) failInput('ASSET_VERSION_SCOPE_INVALID')
  const normalizedSections = normalizeSections(customerContent)
  const sections = normalizedSections.sections
  const markdown = buildMarkdownFromSections(title, sections)
  assertSafeMarkdown(markdown)
  const evidenceReferences = normalizeEvidenceReferences(assetVersion.evidenceReferences)
  const governanceMarkers = normalizeGovernanceMarkers(assetVersion)
  const revision = normalizeRuntimeRevision(assetVersion, runtimeRevision)
  const style = normalizePackReceipt(stylePackReceipt || assetVersion.packReceipts?.style, 'STYLE')
  const visualSystem = normalizePackReceipt(visualSystemPackReceipt || assetVersion.packReceipts?.visualSystem, 'VISUAL_SYSTEM')
  const visualIntent = normalizeVisualIntent(assetVersion)
  if (!ALLOWED_LAYOUT_PATTERNS.includes(visualIntent.layoutPattern)) failInput('LAYOUT_PATTERN_UNSUPPORTED')
  const normalizedOutputContract = {
    outputTypeKey: normalizeText(outputContract.outputTypeKey || assetVersion.outputTypeKey),
    outputSchemaKey: normalizeText(outputContract.outputSchemaKey || assetVersion.outputSchemaKey),
    styleKey: normalizeText(outputContract.styleKey || style.packKey),
    audience: normalizeText(outputContract.audience || assetVersion.audience || 'Leadership'),
    layoutPattern: visualIntent.layoutPattern,
    inferenceSource: 'OUTCOME_STUDIO',
  }
  if (!normalizedOutputContract.outputTypeKey || !normalizedOutputContract.outputSchemaKey) {
    failInput('OUTPUT_CONTRACT_INCOMPLETE')
  }

  const sourceContentChecksum = sha256Json({
    title,
    markdown,
    sections,
    evidenceReferences,
    governanceMarkers,
  })
  return Object.freeze({
    modelVersion: OUTCOME_STUDIO_ASSET_RENDERING_CONTRACT_VERSION,
    assetId,
    assetVersionId,
    assetVersionStatus,
    renderStatus: assetVersionStatus === 'APPROVED' || assetVersionStatus === 'CURRENT' ? 'APPROVED' : 'DRAFT',
    tenantId,
    customerId,
    runtimeInstanceId,
    versionNumber,
    runtimeRevision: revision,
    title,
    outputContract: normalizedOutputContract,
    sections: cloneJson(sections),
    blocks: cloneJson(sections.flatMap((section) => section.blocks.map((block) => ({
      ...block,
      sectionKey: section.key,
      sectionLabel: section.label,
    })))),
    markdown,
    contentSource: normalizedSections.sourceRepresentation,
    evidenceReferences: cloneJson(evidenceReferences),
    governanceMarkers: cloneJson(governanceMarkers),
    styleIntent: {
      tone: normalizeText(assetVersion.styleIntent?.tone || 'EXECUTIVE'),
      emphasis: normalizeText(assetVersion.styleIntent?.emphasis || 'DECISION_CLARITY'),
    },
    visualIntent: cloneJson(visualIntent),
    packReceipts: {
      style: cloneJson(style),
      visualSystem: cloneJson(visualSystem),
    },
    sourceContentChecksum,
    llmRole: 'LAYOUT_AND_COMPONENT_INTENT_ONLY',
  })
}

const registryEntries = Object.freeze({
  MARKDOWN: Object.freeze({
    format: OUTCOME_STUDIO_RENDER_FORMATS.MARKDOWN,
    adapterKey: 'outcome-studio-governed-markdown-adapter',
    templateKey: 'outcome-studio-markdown.v1',
    mimeType: 'text/markdown',
    extension: 'md',
    supportedComponents: DEFAULT_ALLOWED_COMPONENTS,
  }),
  HTML: Object.freeze({
    format: OUTCOME_STUDIO_RENDER_FORMATS.HTML,
    adapterKey: 'outcome-studio-governed-html-adapter',
    templateKey: 'outcome-studio-html.v1',
    mimeType: 'text/html',
    extension: 'html',
    supportedComponents: DEFAULT_ALLOWED_COMPONENTS,
  }),
  DOCX: Object.freeze({
    format: OUTCOME_STUDIO_RENDER_FORMATS.DOCX,
    adapterKey: 'outcome-studio-governed-docx-adapter',
    templateKey: 'professional-document-candidate.v0.1',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
    supportedComponents: DEFAULT_ALLOWED_COMPONENTS,
  }),
  PDF: Object.freeze({
    format: OUTCOME_STUDIO_RENDER_FORMATS.PDF,
    adapterKey: 'outcome-studio-governed-pdf-adapter',
    templateKey: 'professional-pdf-candidate.v0.1',
    mimeType: 'application/pdf',
    extension: 'pdf',
    supportedComponents: DEFAULT_ALLOWED_COMPONENTS,
  }),
  PPTX: Object.freeze({
    format: OUTCOME_STUDIO_RENDER_FORMATS.PPTX,
    adapterKey: 'outcome-studio-governed-pptx-adapter',
    templateKey: 'executive-presentation-neutral.v0.1',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: 'pptx',
    supportedComponents: DEFAULT_ALLOWED_COMPONENTS,
  }),
})

export const OUTCOME_STUDIO_ASSET_RENDERER_REGISTRY = registryEntries

export const listOutcomeStudioAssetRenderers = () => Object.values(registryEntries).map((entry) => ({
  ...entry,
  supportedComponents: [...entry.supportedComponents],
}))

export const resolveOutcomeStudioAssetRenderer = ({ format, outputContract } = {}) => {
  const entry = registryEntries[normalizeToken(format)]
  if (!entry) {
    throw createRenderingError({
      code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.INPUT_INVALID,
      reason: 'RENDER_FORMAT_UNSUPPORTED',
      message: 'The requested Outcome Studio render format is not registered.',
      details: { format: normalizeToken(format) },
    })
  }
  const contract = isPlainObject(outputContract) ? outputContract : {}
  if (!normalizeText(contract.outputTypeKey)
    || !normalizeText(contract.outputSchemaKey)
    || !normalizeText(contract.styleKey)) {
    failInput('OUTPUT_CONTRACT_INCOMPLETE', { format: entry.format })
  }
  return {
    ...entry,
    supportedComponents: [...entry.supportedComponents],
    selectionReason: 'FORMAT_REGISTERED_AND_OUTPUT_CONTRACT_BOUND',
    outputContract: {
      outputTypeKey: normalizeText(contract.outputTypeKey),
      outputSchemaKey: normalizeText(contract.outputSchemaKey),
      styleKey: normalizeText(contract.styleKey),
    },
  }
}

const resolveVisualComponents = (model, renderer) => {
  const allowed = new Set(model.packReceipts.visualSystem.allowedComponents)
  const supported = new Set(renderer.supportedComponents)
  const resolution = { requested: [], accepted: [], effective: [], downgraded: [], unsupported: [] }
  model.visualIntent.components.forEach((component) => {
    resolution.requested.push(component.type)
    if (allowed.has(component.type) && supported.has(component.type)) {
      resolution.accepted.push(component.type)
      resolution.effective.push(component.type)
      return
    }
    const fallbackType = component.fallbackType
    if (fallbackType && allowed.has(fallbackType) && supported.has(fallbackType)) {
      resolution.downgraded.push({ from: component.type, to: fallbackType, reason: 'REQUESTED_COMPONENT_NOT_RENDERABLE' })
      resolution.effective.push(fallbackType)
      return
    }
    resolution.unsupported.push({ type: component.type, reason: allowed.has(component.type)
      ? 'RENDERER_COMPONENT_UNSUPPORTED'
      : 'VISUAL_SYSTEM_COMPONENT_NOT_ALLOWED' })
  })
  if (resolution.unsupported.length) {
    throw createRenderingError({
      code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.VISUAL_UNSUPPORTED,
      reason: 'VISUAL_COMPONENT_UNSUPPORTED',
      message: 'The requested visual component is not allowed by the governed rendering path.',
      details: { unsupported: resolution.unsupported },
    })
  }
  return resolution
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const buildGovernanceMarkdown = (model, visualResolution = {}) => {
  const useCallout = visualResolution.effective?.includes('CALLOUT')
    const boundary = useCallout
    ? [
      '',
      '## Governance boundary',
      '',
      `> Evidence boundary: ${model.governanceMarkers.evidenceBoundary}`,
      '>',
      'Claim restrictions:',
      ...model.governanceMarkers.claimRestrictions.map((item) => `- ${item}`),
    ]
    : [
      '',
      '## Governance boundary',
      '',
      `Evidence boundary: ${model.governanceMarkers.evidenceBoundary}`,
      '',
      'Claim restrictions:',
      ...model.governanceMarkers.claimRestrictions.map((item) => `- ${item}`),
    ]
  return [
    ...boundary,
    ...(model.governanceMarkers.warnings.length ? ['', 'Warnings:', ...model.governanceMarkers.warnings.map((item) => `- ${item}`)] : []),
    ...(model.governanceMarkers.limitations.length ? ['', 'Limitations:', ...model.governanceMarkers.limitations.map((item) => `- ${item}`)] : []),
  ].join('\n')
}

const renderMarkdown = (model, visualResolution = {}) => {
  const output = `${model.markdown}${buildGovernanceMarkdown(model, visualResolution)}`
  assertSafeMarkdown(output)
  return output
}

const renderHtml = (model, visualResolution = {}) => {
  const styleTokens = isPlainObject(model.packReceipts.style.tokens) ? model.packReceipts.style.tokens : {}
  const accent = /^#[0-9a-f]{6}$/i.test(normalizeText(styleTokens.accentColor))
    ? normalizeText(styleTokens.accentColor)
    : '#2c7db9'
  const calloutBackground = /^#[0-9a-f]{6}$/i.test(normalizeText(styleTokens.calloutBackground))
    ? normalizeText(styleTokens.calloutBackground)
    : '#eef6fb'
  const effectiveComponents = Array.isArray(visualResolution.effective) ? visualResolution.effective : []
  const governanceComponent = effectiveComponents[0] || ''
  const sections = model.sections.map((section) => `<section><h2>${escapeHtml(section.label)}</h2>${section.blocks.map((block) => (
    block.type === 'LIST' ? `<ul><li>${escapeHtml(block.text)}</li></ul>` : `<p>${escapeHtml(block.text).replace(/\n/g, '<br>')}</p>`
  )).join('')}</section>`).join('')
  const governance = `<section aria-label="Governance boundary"${governanceComponent ? ` data-visual-component="${escapeHtml(governanceComponent)}"` : ''}${governanceComponent === 'CALLOUT' ? ' class="governance-callout"' : ''}><h2>Governance boundary</h2><p>Evidence boundary: ${escapeHtml(model.governanceMarkers.evidenceBoundary)}</p><h3>Claim restrictions</h3><ul>${model.governanceMarkers.claimRestrictions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>${model.governanceMarkers.warnings.length ? `<h3>Warnings</h3><ul>${model.governanceMarkers.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}${model.governanceMarkers.limitations.length ? `<h3>Limitations</h3><ul>${model.governanceMarkers.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</section>`
  const componentAttribute = effectiveComponents.length ? ` data-effective-visual-components="${escapeHtml(effectiveComponents.join(','))}"` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(model.title)}</title><style>:root{--accent:${accent};--callout-background:${calloutBackground}}body{font-family:Arial,sans-serif;color:#24364a;max-width:960px;margin:0 auto;padding:32px;line-height:1.5}h1{color:var(--accent)}section{margin:24px 0;padding-top:8px;border-top:1px solid #d6dee6}.governance-callout{background:var(--callout-background);border-left:4px solid var(--accent);padding:16px 20px;border-top:0}</style></head><body><main data-asset-version="${escapeHtml(model.assetVersionId)}" data-style-pack="${escapeHtml(model.packReceipts.style.packKey)}" data-visual-system-pack="${escapeHtml(model.packReceipts.visualSystem.packKey)}"${componentAttribute}><h1>${escapeHtml(model.title)}</h1>${sections}${governance}</main></body></html>`
}

const normalizeStyleHex = (value) => {
  const normalized = normalizeText(value)
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.slice(1).toUpperCase() : ''
}

const applyOpenXmlStyleTokens = async (buffer, styleTokens = {}) => {
  const replacements = [
    ['2B6CB0', normalizeStyleHex(styleTokens.accentColor)],
    ['17375E', normalizeStyleHex(styleTokens.headingColor || styleTokens.accentColor)],
    ['EAF2F8', normalizeStyleHex(styleTokens.calloutBackground)],
    ['F4F6F8', normalizeStyleHex(styleTokens.surfaceColor)],
    ['CBD5E1', normalizeStyleHex(styleTokens.borderColor)],
    ['253247', normalizeStyleHex(styleTokens.bodyColor)],
    ['64748B', normalizeStyleHex(styleTokens.mutedColor)],
  ].filter(([, replacement]) => replacement)
  if (!replacements.length) return { buffer, applied: false }

  const archive = await JSZip.loadAsync(buffer)
  const xmlFiles = Object.values(archive.files).filter((file) => !file.dir && /\.xml$/i.test(file.name))
  let changed = false
  for (const file of xmlFiles) {
    const source = await file.async('string')
    const styled = replacements.reduce(
      (value, [from, to]) => value.replace(new RegExp(from, 'gi'), to),
      source,
    )
    if (styled !== source) {
      changed = true
      archive.file(file.name, styled)
    }
  }
  if (!changed) return { buffer, applied: false }
  return {
    buffer: await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    applied: true,
  }
}

const repairPresentationPackage = async (buffer) => {
  const archive = await JSZip.loadAsync(buffer)
  const contentTypesFile = archive.file('[Content_Types].xml')
  if (!contentTypesFile) return { buffer, repaired: false }
  const contentTypes = await contentTypesFile.async('string')
  const repairedContentTypes = contentTypes.replace(
    /<Override PartName="(\/ppt\/slideMasters\/[^\"]+)"[^>]*\/>/g,
    (override, partName) => (archive.file(partName.slice(1)) ? override : ''),
  )
  if (repairedContentTypes === contentTypes) return { buffer, repaired: false }
  archive.file('[Content_Types].xml', repairedContentTypes)
  return {
    buffer: await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    repaired: true,
  }
}

const truncate = (value, max = 256) => normalizeText(value).slice(0, max)
const customerSafeText = (value) => normalizeText(value).replace(/\bruntime\b/gi, 'source')

const chunkText = (value, max = 420) => {
  const normalized = normalizeText(value)
  if (!normalized) return []
  const words = normalized.split(/\s+/)
  const chunks = []
  let current = ''
  words.forEach((word) => {
    if (word.length > max) {
      if (current) {
        chunks.push(current)
        current = ''
      }
      for (let offset = 0; offset < word.length; offset += max) chunks.push(word.slice(offset, offset + max))
      return
    }
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > max && current) {
      chunks.push(current)
      current = word
    } else {
      current = candidate
    }
  })
  if (current) chunks.push(current)
  return chunks
}

const buildPresentationNotes = (model, sourceLabel = '') => {
  const label = sourceLabel ? ` The source section is ${sourceLabel}.` : ''
  return `This governed presentation is one presentation of the same Outcome Studio asset version as the other output formats. It preserves the recorded evidence references and claim restrictions. It does not create new claims or change the authoritative asset.${label} Review the visible governance boundary before reuse.`
}

const buildPresentationGovernanceSteps = (model) => [
  { label: 'Evidence boundary', values: chunkText(customerSafeText(model.governanceMarkers.evidenceBoundary), 460) },
  { label: 'Claim restriction', values: model.governanceMarkers.claimRestrictions.flatMap((item) => chunkText(item, 460)) },
  { label: 'Warning', values: model.governanceMarkers.warnings.flatMap((item) => chunkText(item, 460)) },
  { label: 'Limitation', values: model.governanceMarkers.limitations.flatMap((item) => chunkText(item, 460)) },
].flatMap(({ label, values }) => values.map((detail, index) => ({
  label: values.length > 1 ? `${label} ${index + 1}` : label,
  detail,
})))

const buildPresentationInput = (model, visualResolution = {}) => {
  const firstSection = model.sections[0]
  const firstText = firstSection?.blocks?.[0]?.text || model.markdown
  const effectiveVisualComponent = visualResolution.effective?.[0]
  const qualifierPrefix = effectiveVisualComponent === 'CALLOUT' ? 'Governance callout: ' : 'Evidence boundary: '
  const contentSlides = model.sections.flatMap((section) => section.blocks.flatMap((block) => chunkText(
    `${block.type === 'LIST' ? '• ' : ''}${block.text}`,
    460,
  ).map((text, index, chunks) => ({
    layout: 'DECISION',
    title: `${section.label}${chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : ''}`,
    notes: buildPresentationNotes(model, section.label),
    content: {
      statement: text,
      metrics: [{
        label: 'Asset version',
        value: `v${model.versionNumber}`,
        detail: 'Recorded source revision',
        tone: 'PRIMARY',
      }],
      qualifier: `${qualifierPrefix}${truncate(customerSafeText(model.governanceMarkers.evidenceBoundary), 240)}`,
    },
  }))))
  const governanceSteps = buildPresentationGovernanceSteps(model)
  const governanceGroups = []
  for (let index = 0; index < governanceSteps.length; index += 6) {
    const group = governanceSteps.slice(index, index + 6)
    if (group.length === 1) group.push({ label: 'Review claims', detail: 'Keep restrictions and limitations visible.' })
    governanceGroups.push(group)
  }
  const customerSafeEvidenceBoundary = truncate(customerSafeText(model.governanceMarkers.evidenceBoundary), 240)
  return {
    schemaVersion: 'governed-deliverable.v1',
    deliverableFamily: 'PRESENTATION',
    metadata: {
      title: model.title,
      subtitle: model.outputContract.outputTypeKey,
      audience: model.outputContract.audience,
      status: model.renderStatus,
      versionNumber: model.versionNumber,
      disclosure: 'Governed asset rendering; evidence and claim boundaries preserved.',
    },
    slides: [
      {
        layout: 'COVER',
        title: model.title,
        notes: buildPresentationNotes(model),
        content: {
          eyebrow: 'Governed Outcome Studio Asset',
          subtitle: truncate(firstText, 240),
          audience: model.outputContract.audience,
        },
      },
      ...contentSlides,
      ...governanceGroups.map((steps, index) => ({
        layout: 'CLOSING',
        title: `Governance boundary${governanceGroups.length > 1 ? ` (${index + 1}/${governanceGroups.length})` : ''}`,
        notes: buildPresentationNotes(model, 'governance boundary'),
        content: {
          statement: 'Use only within the recorded evidence boundary.',
          subtitle: customerSafeEvidenceBoundary,
          steps,
        },
      })),
    ],
  }
}

const renderArtifact = async (model, renderer, markdown, visualResolution) => {
  const metadata = {
    title: model.title,
    deliverableType: model.outputContract.outputTypeKey,
    versionNumber: model.versionNumber,
    status: model.renderStatus,
  }
  if (renderer.format === OUTCOME_STUDIO_RENDER_FORMATS.MARKDOWN) return { buffer: Buffer.from(markdown, 'utf8'), validationChecks: ['MARKDOWN_NON_EMPTY'] }
  if (renderer.format === OUTCOME_STUDIO_RENDER_FORMATS.HTML) return { buffer: Buffer.from(renderHtml(model, visualResolution), 'utf8'), validationChecks: ['HTML_DOCUMENT_VALID', 'HTML_ESCAPED_TEXT_VALID', ...(visualResolution.effective?.length ? ['VISUAL_PLAN_APPLIED'] : [])] }
  if (renderer.format === OUTCOME_STUDIO_RENDER_FORMATS.DOCX) {
    const result = await renderProfessionalDocumentCandidate({ documentMetadata: metadata, markdown })
    const styled = await applyOpenXmlStyleTokens(result.buffer, model.packReceipts.style.tokens)
    return { buffer: styled.buffer, validationChecks: [...result.validation.checks, ...(styled.applied ? ['STYLE_TOKENS_APPLIED'] : [])] }
  }
  if (renderer.format === OUTCOME_STUDIO_RENDER_FORMATS.PDF) {
    const result = await renderProfessionalPdfCandidate({ documentMetadata: metadata, markdown, styleTokens: model.packReceipts.style.tokens })
    return { buffer: result.buffer, validationChecks: ['PDF_CANDIDATE_VALID', `PDF_PAGES_${result.validation.pageCount}`] }
  }
  const result = await renderProfessionalPresentationCandidate(buildPresentationInput(model, visualResolution))
  const repaired = await repairPresentationPackage(result.buffer)
  const styled = await applyOpenXmlStyleTokens(repaired.buffer, model.packReceipts.style.tokens)
  return {
    buffer: styled.buffer,
    validationChecks: [
      ...result.validation.checks,
      ...(repaired.repaired ? ['PPTX_ORPHAN_SLIDE_MASTER_OVERRIDES_REMOVED'] : []),
      ...(styled.applied ? ['STYLE_TOKENS_APPLIED'] : []),
    ],
  }
}

const validateArtifact = ({ renderer, buffer }) => {
  const valid = renderer.format === OUTCOME_STUDIO_RENDER_FORMATS.MARKDOWN
    ? buffer.length > 0
    : renderer.format === OUTCOME_STUDIO_RENDER_FORMATS.HTML
      ? buffer.toString('utf8').startsWith('<!doctype html>')
      : renderer.format === OUTCOME_STUDIO_RENDER_FORMATS.PDF
        ? buffer.toString('utf8', 0, 5) === '%PDF-'
        : buffer.subarray(0, 2).toString('utf8') === 'PK'
  if (!valid) {
    throw createRenderingError({
      code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.VALIDATION_FAILED,
      reason: 'RENDERED_ARTIFACT_SIGNATURE_INVALID',
      message: 'The governed render did not pass artifact validation.',
      details: { format: renderer.format },
    })
  }
}

const filenamePart = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'outcome-asset'

export const buildOutcomeStudioRenderOutputRecord = ({
  model,
  renderer,
  visualResolution,
  buffer,
  validationChecks,
  renderOutputId = `outcome_render_output_${randomUUID()}`,
} = {}) => {
  const artifact = {
    filename: `${filenamePart(model.title)}-v${model.versionNumber}.${renderer.extension}`,
    mimeType: renderer.mimeType,
    extension: renderer.extension,
    byteLength: buffer.length,
    outputChecksum: sha256Buffer(buffer),
  }
  const rendererReceipt = {
    adapterKey: renderer.adapterKey,
    templateKey: renderer.templateKey,
    registryVersion: OUTCOME_STUDIO_ASSET_RENDERING_REGISTRY_VERSION,
    format: renderer.format,
    supportedComponents: [...renderer.supportedComponents],
    selectionReason: renderer.selectionReason,
    outputContract: cloneJson(renderer.outputContract),
  }
  const renderReceipt = {
    contractVersion: OUTCOME_STUDIO_ASSET_RENDERING_CONTRACT_VERSION,
    source: {
      assetId: model.assetId,
      assetVersionId: model.assetVersionId,
      versionNumber: model.versionNumber,
      runtimeRevision: cloneJson(model.runtimeRevision),
      sourceContentChecksum: model.sourceContentChecksum,
      contentSource: model.contentSource,
    },
    outputContract: cloneJson(model.outputContract),
    renderer: rendererReceipt,
    format: renderer.format,
    stylePackReceipt: cloneJson(model.packReceipts.style),
    visualSystemPackReceipt: cloneJson(model.packReceipts.visualSystem),
    visualResolution: cloneJson(visualResolution),
    appliedInputs: {
      stylePack: {
        tokenKeys: Object.keys(model.packReceipts.style.tokens || {}),
        appliedTo: renderer.format === OUTCOME_STUDIO_RENDER_FORMATS.MARKDOWN
          ? []
          : [renderer.format],
      },
      visualSystem: {
        effectiveComponents: [...(visualResolution.effective || [])],
        appliedTo: visualResolution.effective?.length ? [renderer.format] : [],
      },
    },
    governanceMarkers: cloneJson(model.governanceMarkers),
    exportStatus: OUTCOME_STUDIO_RENDER_OUTPUT_STATUSES.READY,
    validation: { status: 'PASS', checks: [...new Set(validationChecks)] },
    llmRole: model.llmRole,
    contentIncludedInReceipt: false,
  }
  return {
    renderOutputId,
    outcomeAssetId: model.assetId,
    outcomeAssetVersionId: model.assetVersionId,
    tenantId: model.tenantId,
    customerId: model.customerId,
    runtimeInstanceId: model.runtimeInstanceId,
    runtimeRevisionId: model.runtimeRevision.id,
    versionNumber: model.versionNumber,
    format: renderer.format,
    status: OUTCOME_STUDIO_RENDER_OUTPUT_STATUSES.READY,
    sourceContentChecksum: model.sourceContentChecksum,
    outputContract: cloneJson(model.outputContract),
    renderer: rendererReceipt,
    stylePackReceipt: cloneJson(model.packReceipts.style),
    visualSystemPackReceipt: cloneJson(model.packReceipts.visualSystem),
    visualResolution: cloneJson(visualResolution),
    artifact,
    renderReceipt,
  }
}

const assertExistingRenderOutputsMatchSource = (model, existingRenderOutputs = []) => {
  if (!Array.isArray(existingRenderOutputs)) failInput('EXISTING_RENDER_OUTPUTS_INVALID')
  const conflictingOutput = existingRenderOutputs.find((output) => (
    normalizeText(output?.outcomeAssetVersionId) === model.assetVersionId
    && normalizeText(output?.sourceContentChecksum)
    && output.sourceContentChecksum !== model.sourceContentChecksum
  ))
  if (conflictingOutput) {
    throw createRenderingError({
      code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.CONTENT_CHANGED_REQUIRES_NEW_VERSION,
      reason: 'ASSET_VERSION_CONTENT_CHANGED_REQUIRES_NEW_VERSION',
      message: 'Changed governed content requires a new Outcome Studio Asset Version.',
      details: {
        assetVersionId: model.assetVersionId,
        existingRenderOutputId: normalizeText(conflictingOutput.renderOutputId),
      },
    })
  }
}

export const renderOutcomeStudioAsset = async ({
  assetVersion,
  runtimeRevision,
  outputContract,
  outputContractResolution,
  stylePackReceipt,
  visualSystemPackReceipt,
  evidenceReferences,
  governanceMarkers,
  visualIntent,
  formats = Object.values(OUTCOME_STUDIO_RENDER_FORMATS),
  persistRenderOutput = null,
  existingRenderOutputs = [],
} = {}) => {
  if (typeof persistRenderOutput !== 'function') {
    throw createRenderingError({
      code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.RECEIPT_PERSISTENCE_REQUIRED,
      reason: 'RENDER_OUTPUT_RECEIPT_PERSISTENCE_REQUIRED',
      message: 'A receipt persistence callback is required before governed delivery.',
    })
  }
  const model = assetVersion && typeof assetVersion.toObject === 'function'
    ? buildOutcomeStudioRenderableAssetFromPersistedVersion({
      assetVersion,
      runtimeRevision,
      outputContract,
      outputContractResolution,
      stylePackReceipt,
      visualSystemPackReceipt,
      evidenceReferences,
      governanceMarkers,
      visualIntent,
    })
    : buildOutcomeStudioRenderableAsset({
      assetVersion: {
        ...(isPlainObject(assetVersion) ? assetVersion : {}),
        ...(evidenceReferences ? { evidenceReferences } : {}),
        ...(governanceMarkers ? { governanceMarkers } : {}),
        ...(visualIntent ? { visualIntent } : {}),
      },
      runtimeRevision,
      outputContract,
      stylePackReceipt,
      visualSystemPackReceipt,
    })
  assertExistingRenderOutputsMatchSource(model, existingRenderOutputs)
  const renderOutputs = []
  for (const format of formats) {
    const renderer = resolveOutcomeStudioAssetRenderer({ format, outputContract: model.outputContract })
    const visualResolution = resolveVisualComponents(model, renderer)
    const markdown = renderMarkdown(model, visualResolution)
    let rendered
    try {
      rendered = await renderArtifact(model, renderer, markdown, visualResolution)
      validateArtifact({ renderer, buffer: rendered.buffer })
    } catch (cause) {
      if (cause?.name === 'OutcomeStudioAssetRenderingError') throw cause
      throw createRenderingError({
        code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.RENDER_FAILED,
        reason: 'RENDERER_EXECUTION_FAILED',
        message: 'The governed Outcome Studio render failed.',
        details: { format: renderer.format },
        cause,
      })
    }
    const record = buildOutcomeStudioRenderOutputRecord({
      model,
      renderer,
      visualResolution,
      buffer: rendered.buffer,
      validationChecks: rendered.validationChecks,
    })
    try {
      await persistRenderOutput(record)
    } catch (cause) {
      throw createRenderingError({
        code: OUTCOME_STUDIO_ASSET_RENDERING_ERROR_CODES.RECEIPT_PERSISTENCE_FAILED,
        reason: 'RENDER_OUTPUT_RECEIPT_PERSISTENCE_FAILED',
        message: 'The render receipt could not be recorded, so the output is unavailable.',
        details: { format: renderer.format },
        cause,
      })
    }
    renderOutputs.push({
      record,
      delivery: {
        format: renderer.format,
        filename: record.artifact.filename,
        mimeType: record.artifact.mimeType,
        encoding: 'base64',
        contentBase64: rendered.buffer.toString('base64'),
        exportAvailable: true,
      },
    })
  }
  return { model, renderOutputs }
}

export const __testables = Object.freeze({
  buildGovernanceMarkdown,
  buildPresentationInput,
  renderHtml,
  renderMarkdown,
  resolveVisualComponents,
})
