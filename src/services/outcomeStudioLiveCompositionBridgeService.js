import { parse as parseYaml } from 'yaml'

import {
  FRAMEWORK_OUTCOME_CLAIM_TYPES,
  FRAMEWORK_OUTCOME_HANDOFF_POLICY_VERSION,
} from './outcomeFrameworkHandoffService.js'
import { loadOutcomeKnowledgePackVersionContent } from './outcomeKnowledgePackRegistryService.js'
import { buildOutcomeStudioEvidenceComposition } from './outcomeStudioEvidenceCompositionService.js'
import { buildOutcomeStudioGenerationContextConsumption } from './outcomeStudioProviderSafeContextService.js'

export const OUTCOME_STUDIO_LIVE_COMPOSITION_BRIDGE_CONTRACT =
  'outcome-studio.live-composition-bridge.v1'

export const OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS = Object.freeze({
  KNOWLEDGE_CONTEXT_BLOCKED: 'LIVE_COMPOSITION_KNOWLEDGE_CONTEXT_BLOCKED',
  KNOWLEDGE_CONTENT_UNAVAILABLE: 'LIVE_COMPOSITION_KNOWLEDGE_CONTENT_UNAVAILABLE',
  KNOWLEDGE_CONTENT_HASH_MISMATCH: 'LIVE_COMPOSITION_KNOWLEDGE_CONTENT_HASH_MISMATCH',
  KNOWLEDGE_CONTENT_IDENTITY_MISMATCH: 'LIVE_COMPOSITION_KNOWLEDGE_CONTENT_IDENTITY_MISMATCH',
  KNOWLEDGE_CONTENT_FORMAT_UNSUPPORTED: 'LIVE_COMPOSITION_KNOWLEDGE_CONTENT_FORMAT_UNSUPPORTED',
  KNOWLEDGE_CONTENT_SHAPE_INVALID: 'LIVE_COMPOSITION_KNOWLEDGE_CONTENT_SHAPE_INVALID',
  METHOD_GUIDANCE_INVALID: 'LIVE_COMPOSITION_METHOD_GUIDANCE_INVALID',
  METHOD_BOUNDARY_MISSING: 'LIVE_COMPOSITION_METHOD_BOUNDARY_MISSING',
  GOVERNANCE_CONSTRAINTS_INVALID: 'LIVE_COMPOSITION_GOVERNANCE_CONSTRAINTS_INVALID',
  TRUTH_IDENTITY_MISSING: 'LIVE_COMPOSITION_TRUTH_IDENTITY_MISSING',
  READY_WITH_GAPS_BLOCKED: 'LIVE_COMPOSITION_READY_WITH_GAPS_BLOCKED',
  COMPOSITION_FAILED: 'LIVE_COMPOSITION_COMPOSITION_FAILED',
})

const ROLE_REGISTRY = Object.freeze({
  ARL: Object.freeze({
    packKey: 'adaptive-reasoning-layer',
    boundary: 'GENERATION_CONTEXT',
  }),
  RL: Object.freeze({
    packKey: 'rendering-layer',
    boundary: 'POST_GENERATION_VALIDATION',
  }),
})

const SUPPORTED_CONTENT_FORMATS = new Set(['MARKDOWN', 'YAML', 'YML', 'JSON'])

const normalizeText = (value) => String(value ?? '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeKey = (value) => normalizeText(value).toLowerCase().replace(/_/g, '-')
const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const unique = (values = []) => [...new Set(values.map(normalizeText).filter(Boolean))]
const safeText = (value) => normalizeText(value).replace(/\s+/g, ' ')
const normalizeDuplicateIdentity = (value) => safeText(value)
  .toLowerCase()
  .replace(/[\s_]+/g, '-')

const block = (reason, details = {}) => {
  const error = new Error('Outcome Studio live composition is blocked.')
  error.status = 409
  error.code = 'OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKED'
  error.reason = reason
  error.details = details
  throw error
}

const internalTermPattern = /\b(?:knowledge\s+pack|manifest|activation|dependency\s+graph|database\s+identifier|runtime\s+graph|provider\s+context|system\s+prompt|certified\s+truth)\b/i

const projectProviderSafeText = (value, details = {}) => {
  const projected = safeText(value)
    .replace(/knowledge\s+packs?/gi, 'governed guidance')
    .replace(/certified\s+truth/gi, 'verified business information')
    .replace(/activation/gi, 'selection')
    .replace(/dependency\s+graph/gi, 'dependency map')
    .replace(/database\s+identifier/gi, 'record identifier')
    .replace(/runtime\s+graph/gi, 'runtime relationship view')
    .replace(/provider\s+context/gi, 'generation context')
    .replace(/system\s+prompt/gi, 'hidden instructions')
    .replace(/manifest/gi, 'safety checklist')
  if (!projected || internalTermPattern.test(projected)) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
      ...details,
      field: 'providerSafeProjection',
    })
  }
  return projected
}

const boundedText = (value, maximum = 600) => {
  const normalized = safeText(value)
  if (normalized.length <= maximum) return normalized
  return `${normalized.slice(0, maximum - 3).trim()}...`
}

const getCaseInsensitiveKey = (value, key) => {
  if (!isObject(value)) return ''
  const target = normalizeKey(key)
  return Object.keys(value).find((candidate) => normalizeKey(candidate) === target) || ''
}

const getPath = (value, path = []) => {
  let cursor = value
  for (const segment of path) {
    const key = getCaseInsensitiveKey(cursor, segment)
    if (!key) return undefined
    cursor = cursor[key]
  }
  return cursor
}

const getFirstPath = (value, paths = []) => {
  for (const path of paths) {
    const candidate = getPath(value, path)
    if (candidate !== undefined && candidate !== null) return candidate
  }
  return undefined
}

const collectStrings = (value) => {
  if (typeof value === 'string') return [safeText(value)].filter(Boolean)
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  return []
}

const parseStructuredContent = ({ content, selection }) => {
  const format = normalizeToken(selection.contentFormat || selection.format)
  if (!['YAML', 'YML', 'JSON'].includes(format)) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_FORMAT_UNSUPPORTED, {
      packKey: normalizeText(selection.packKey),
      contentFormat: format,
    })
  }
  try {
    const parsed = format === 'JSON' ? JSON.parse(content) : parseYaml(content)
    if (!isObject(parsed)) throw new Error('Structured Knowledge content must be an object.')
    return parsed
  } catch (error) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
      packKey: normalizeText(selection.packKey),
      contentFormat: format,
      cause: error.message,
    })
  }
}

const extractMarkdownSection = (content, heading) => {
  const lines = String(content || '').split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`, 'i').test(line.trim()))
  if (start < 0) return []
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()))
  return lines.slice(start + 1, end < 0 ? lines.length : end)
}

const parseMarkdownNumberedStructure = ({ content, selection }) => {
  const lines = extractMarkdownSection(content, 'Required Structure')
    .map((line) => line.trim())
    .filter(Boolean)
  const entries = lines.map((line) => {
    const match = line.match(/^(\d+)\.\s+(.+)$/)
    return match ? { number: Number(match[1]), value: safeText(match[2]) } : null
  })
  if (entries.length !== 5
    || entries.some((entry, index) => !entry || entry.number !== index + 1 || !entry.value)) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
      packKey: normalizeText(selection.packKey),
      field: 'Required Structure',
      expectedCount: 5,
      actualCount: entries.length,
    })
  }
  const values = entries.map((entry) => entry.value)
  const normalizedValues = values.map(normalizeDuplicateIdentity)
  if (new Set(normalizedValues).size !== normalizedValues.length) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
      packKey: normalizeText(selection.packKey),
      field: 'Required Structure',
      reason: 'DUPLICATE_VALUES',
      values: [...new Set(normalizedValues.filter((value, index) => normalizedValues.indexOf(value) !== index))],
    })
  }
  return values
}

const parseMarkdownGovernanceRules = ({ content, selection }) => {
  const lines = extractMarkdownSection(content, 'Governance Rules')
    .map((line) => line.trim())
    .filter(Boolean)
  const rules = lines
    .map((line) => line.match(/^[-*]\s+(.+)$/)?.[1] || '')
    .map(safeText)
    .filter(Boolean)
  if (rules.length === 0) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.GOVERNANCE_CONSTRAINTS_INVALID, {
      packKey: normalizeText(selection.packKey),
      field: 'Governance Rules',
    })
  }
  return rules
}

const requireStringArray = (value, details = {}) => {
  if (!Array.isArray(value) || value.length === 0
    || value.some((entry) => typeof entry !== 'string' || !safeText(entry))) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, details)
  }
  return value.map(safeText)
}

const assertPackSelection = ({ selection, role = '', requireBoundary = false }) => {
  if (!isObject(selection)
    || !normalizeText(selection.packId)
    || !normalizeText(selection.versionId)
    || !normalizeText(selection.packKey)
    || !normalizeText(selection.contentHash)
    || !normalizeText(selection.semanticVersion)
    || !normalizeText(selection.activationId)
    || normalizeToken(selection.status) !== 'ACTIVE'
    || (requireBoundary && normalizeToken(selection.boundary) !== ROLE_REGISTRY[role].boundary)) {
    block(requireBoundary && normalizeToken(selection?.boundary) !== ROLE_REGISTRY[role].boundary
      ? OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.METHOD_BOUNDARY_MISSING
      : OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH, {
      role,
      packKey: normalizeText(selection?.packKey),
      requiredBoundary: requireBoundary ? ROLE_REGISTRY[role].boundary : '',
    })
  }
  return selection
}

const assertActiveLineageMembership = ({ selection, binding }) => {
  const activationIds = Array.isArray(binding?.lineage?.activationIds)
    ? binding.lineage.activationIds.map(normalizeText)
    : []
  const versionIds = Array.isArray(binding?.lineage?.versionIds)
    ? binding.lineage.versionIds.map(normalizeText)
    : []
  const contentHashes = Array.isArray(binding?.lineage?.contentHashes)
    ? binding.lineage.contentHashes.map(normalizeText)
    : []
  const missingMembership = [
    ...(!activationIds.includes(normalizeText(selection.activationId)) ? ['activationId'] : []),
    ...(!versionIds.includes(normalizeText(selection.versionId)) ? ['versionId'] : []),
    ...(!contentHashes.includes(normalizeText(selection.contentHash)) ? ['contentHash'] : []),
  ]
  if (missingMembership.length > 0) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH, {
      packKey: normalizeText(selection.packKey),
      missingMembership,
    })
  }
}

const collectBindingPackEntries = (binding = {}) => {
  const entries = []
  const add = (value) => {
    if (Array.isArray(value)) entries.push(...value)
  }
  add(binding.activePacks)
  add(binding.requiredPacks)
  add(binding.providerContextPacks)
  add(binding.preValidationPacks)
  add(binding.postValidationPacks)
  if (isObject(binding.selectedByLayer)) Object.values(binding.selectedByLayer).forEach(add)
  return entries
}

const findPackSelection = ({ binding, packKey, layer, capabilityKey = '' }) => {
  const entries = collectBindingPackEntries(binding)
    .filter((entry) => normalizeKey(entry?.packKey) === normalizeKey(packKey))
    .filter((entry) => !capabilityKey || normalizeKey(entry?.capabilityKey) === normalizeKey(capabilityKey))
  const layerEntries = Array.isArray(binding?.selectedByLayer?.[layer])
    ? binding.selectedByLayer[layer]
    : []
  const candidates = entries.length > 0
    ? entries
    : layerEntries.filter((entry) => !capabilityKey || normalizeKey(entry?.capabilityKey) === normalizeKey(capabilityKey))
  const uniqueCandidates = [...new Map(candidates.map((entry) => [
    `${normalizeText(entry?.packId)}:${normalizeText(entry?.versionId)}`,
    entry,
  ])).values()]
  if (uniqueCandidates.length !== 1) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_UNAVAILABLE, {
      packKey,
      layer,
      capabilityKey,
      candidateCount: uniqueCandidates.length,
    })
  }
  return uniqueCandidates[0]
}

const loadSelectedContent = async ({ selection, binding, loadPackContent }) => {
  assertPackSelection({ selection })
  assertActiveLineageMembership({ selection, binding })
  let loaded
  try {
    loaded = await loadPackContent({
      packId: selection.packId,
      versionId: selection.versionId,
    })
  } catch (error) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_UNAVAILABLE, {
      packKey: normalizeText(selection.packKey),
      versionId: normalizeText(selection.versionId),
      cause: error.message,
    })
  }
  if (!loaded?.available || typeof loaded.content !== 'string') {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_UNAVAILABLE, {
      packKey: normalizeText(selection.packKey),
      versionId: normalizeText(selection.versionId),
    })
  }
  const loadedIdentity = {
    packId: normalizeText(loaded.packId),
    versionId: normalizeText(loaded.versionId),
    packKey: normalizeKey(loaded.packKey),
    semanticVersion: normalizeText(loaded.semanticVersion),
    contentHash: normalizeText(loaded.contentHash),
    contentFormat: normalizeToken(loaded.contentFormat),
    status: normalizeToken(loaded.status),
  }
  const missingFields = Object.entries(loadedIdentity)
    .filter(([, value]) => !value)
    .map(([field]) => field)
  if (missingFields.length > 0) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH, {
      packKey: normalizeText(selection.packKey),
      missingFields,
    })
  }
  const mismatches = [
    ...(!loadedIdentity.packId || loadedIdentity.packId !== normalizeText(selection.packId) ? ['packId'] : []),
    ...(!loadedIdentity.versionId || loadedIdentity.versionId !== normalizeText(selection.versionId) ? ['versionId'] : []),
    ...(!loadedIdentity.packKey || loadedIdentity.packKey !== normalizeKey(selection.packKey) ? ['packKey'] : []),
    ...(!loadedIdentity.semanticVersion || loadedIdentity.semanticVersion !== normalizeText(selection.semanticVersion) ? ['semanticVersion'] : []),
    ...(!loadedIdentity.contentHash || loadedIdentity.contentHash !== normalizeText(selection.contentHash) ? ['contentHash'] : []),
    ...(!loadedIdentity.status || loadedIdentity.status !== 'ACTIVE' ? ['status'] : []),
  ]
  const selectedFormatHint = normalizeToken(selection.contentFormat)
  if (selectedFormatHint && loadedIdentity.contentFormat !== selectedFormatHint) {
    mismatches.push('contentFormat')
  }
  if (mismatches.length > 0) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_IDENTITY_MISMATCH, {
      packKey: normalizeText(selection.packKey),
      versionId: normalizeText(selection.versionId),
      mismatches,
    })
  }
  if (!SUPPORTED_CONTENT_FORMATS.has(loadedIdentity.contentFormat)) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_FORMAT_UNSUPPORTED, {
      packKey: normalizeText(selection.packKey),
      contentFormat: loadedIdentity.contentFormat,
    })
  }
  return {
    selection: {
      ...selection,
      contentFormat: loadedIdentity.contentFormat,
    },
    content: loaded.content,
    contentHash: loadedIdentity.contentHash,
    contentFormat: loadedIdentity.contentFormat,
  }
}

const resolveOutputStructure = ({ content, selection, requestedOutputTypeKey }) => {
  if (normalizeToken(selection.contentFormat) === 'MARKDOWN') {
    return parseMarkdownNumberedStructure({ content, selection })
  }
  const document = parseStructuredContent({ content, selection })
  const requestedKey = normalizeKey(requestedOutputTypeKey)
  const scopedOutputTypeDocument = getFirstPath(document, [
    ['output_types', requestedKey, 'required_structure'],
    ['output_types', requestedKey, 'structure'],
  ])
  const directOutputTypeIdentity = normalizeKey(getFirstPath(document, [
    ['outputTypeKey'],
    ['output_type', 'key'],
    ['pack', 'capabilityKey'],
  ]))
  const directOutputTypeDocument = directOutputTypeIdentity && directOutputTypeIdentity !== requestedKey
    ? undefined
    : getFirstPath(document, [
    ['output_type', 'required_structure'],
    ['output_type', 'structure'],
    ['outputTypeStructure'],
  ])
  const outputTypeDocument = scopedOutputTypeDocument || directOutputTypeDocument
  const values = Array.isArray(outputTypeDocument)
    ? requireStringArray(outputTypeDocument, {
        packKey: normalizeText(selection.packKey),
        field: 'outputTypeStructure',
      })
    : []
  if (values.length !== 5 || new Set(values.map(normalizeKey)).size !== 5) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
      packKey: normalizeText(selection.packKey),
      field: 'outputTypeStructure',
      expectedCount: 5,
      actualCount: values.length,
    })
  }
  return values
}

const resolveOutputTypeGovernance = ({ content, selection }) => {
  if (normalizeToken(selection.contentFormat) === 'MARKDOWN') {
    return parseMarkdownGovernanceRules({ content, selection })
  }
  const document = parseStructuredContent({ content, selection })
  const values = [
    ['governanceRules'],
    ['governance_rules'],
    ['prohibited'],
    ['governance_rules', 'must_not'],
    ['governanceRules', 'must_not'],
    ['governanceRules', 'prohibited'],
  ].flatMap((path) => collectStrings(getPath(document, path)))
  if (values.length === 0) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.GOVERNANCE_CONSTRAINTS_INVALID, {
      packKey: normalizeText(selection.packKey),
      field: 'outputTypeGovernance',
    })
  }
  return values
}

const resolveSchemaProjection = ({ content, selection, schemaKey }) => {
  if (normalizeToken(selection.contentFormat) === 'MARKDOWN') {
    const directHeadings = [...String(content || '').matchAll(/^##\s+(.+)$/gm)]
      .map((match) => safeText(match[1]))
      .filter(Boolean)
    const metadataHeadings = new Set([
      'purpose',
      'intended use',
      'required structure',
      'required sections',
      'optional sections',
      'section rules',
      'governance rules',
      'prohibited',
      'prohibited claims',
      'output controls',
      'schema metadata',
    ])
    const optionalHeadingPattern = /^(truth certification|output warnings)$/i
    const parseSchemaList = (headings, { required = false, sectionDefinitions = false } = {}) => {
      if (headings.some((heading) => directHeadings.filter((value) => value.toLowerCase() === heading.toLowerCase()).length > 1)) {
        block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
          packKey: normalizeText(selection.packKey), field: headings[0], reason: 'DUPLICATE_CONTAINERS',
        })
      }
      const lines = headings
        .flatMap((heading) => extractMarkdownSection(content, heading))
        .map((line) => line.trim())
        .filter(Boolean)
      const childHeadings = sectionDefinitions ? lines.filter((line) => /^###(?:\s|$)/.test(line)) : []
      if (childHeadings.some((line) => !/^###\s+\S/.test(line))
        || (childHeadings.length && lines.slice(0, lines.indexOf(childHeadings[0])).some((line) => /^(?:\d+\.|[-*])\s+/.test(line)))) {
        block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
          packKey: normalizeText(selection.packKey), field: headings[0], reason: 'AMBIGUOUS_SECTION_STRUCTURE',
        })
      }
      const values = childHeadings.length
        ? childHeadings.map((line) => safeText(line.replace(/^###\s+/, '')))
        : lines
        .map((line) => line.match(/^(?:\d+\.|[-*])\s+(.+)$/)?.[1] || '')
        .map(safeText)
        .filter(Boolean)
      if (required && values.length === 0) {
        block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
          packKey: normalizeText(selection.packKey),
          schemaKey,
          field: headings[0],
        })
      }
      return values
    }
    const hasRequiredContainer = directHeadings.some((heading) => heading.toLowerCase() === 'required sections')
    let requiredSections = parseSchemaList(['Required Sections'], { required: hasRequiredContainer, sectionDefinitions: true })
    if (!hasRequiredContainer) {
      requiredSections = directHeadings
        .filter((heading) => !metadataHeadings.has(heading.toLowerCase()))
        .filter((heading) => !optionalHeadingPattern.test(heading))
    }
    if (requiredSections.length === 0) {
      block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
        packKey: normalizeText(selection.packKey),
        schemaKey,
        field: 'Required Sections',
      })
    }
    const optionalSections = parseSchemaList(['Optional Sections'], { sectionDefinitions: true })
    const directOptionalSections = directHeadings.filter((heading) => optionalHeadingPattern.test(heading))
    const resolvedOptionalSections = optionalSections.length > 0 ? optionalSections : directOptionalSections
    const prohibited = parseSchemaList(['Prohibited', 'Prohibited Claims', 'Output Controls', 'Governance Rules'])
    const allSections = [...requiredSections, ...resolvedOptionalSections]
    if (new Set(allSections.map(normalizeDuplicateIdentity)).size !== allSections.length) {
      block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
        packKey: normalizeText(selection.packKey),
        schemaKey,
        field: 'Required Sections',
        reason: 'DUPLICATE_VALUES',
      })
    }
    return {
      requiredSections,
      optionalSections: resolvedOptionalSections,
      governance: {
        schemaProhibited: prohibited,
      },
    }
  }
  const document = parseStructuredContent({ content, selection })
  const schemaKeys = unique([
    schemaKey,
    normalizeText(schemaKey).replace(/[-_]schema$/i, ''),
  ])
  const schema = schemaKeys
    .map((candidate) => getPath(document, ['schemas', candidate]))
    .find(isObject)
  const rawRequiredSections = getPath(schema, ['required_sections'])
  const rawOptionalSections = getPath(schema, ['optional_sections'])
  const requiredSections = requireStringArray(rawRequiredSections, {
    packKey: normalizeText(selection.packKey),
    schemaKey,
    field: 'required_sections',
  })
  const optionalSections = rawOptionalSections === undefined
    ? []
    : requireStringArray(rawOptionalSections, {
        packKey: normalizeText(selection.packKey),
        schemaKey,
        field: 'optional_sections',
      })
  const schemaProhibited = requireStringArray(getPath(schema, ['prohibited']), {
    packKey: normalizeText(selection.packKey),
    schemaKey,
    field: 'prohibited',
  })
  if (requiredSections.length === 0
    || new Set(requiredSections.map(normalizeKey)).size !== requiredSections.length) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_SHAPE_INVALID, {
      packKey: normalizeText(selection.packKey),
      schemaKey: schemaKey || schemaKeys[0],
      field: 'required_sections',
    })
  }
  return {
    requiredSections,
    optionalSections,
    governance: {
      ...Object.fromEntries([
        ['globalRules', getPath(document, ['global_rules'])],
        ['schemaProhibited', schemaProhibited],
      ].filter(([, value]) => value !== undefined)),
    },
  }
}

const buildMethodGuidance = ({ role, loaded, selectedFormat = '' }) => {
  const selection = assertPackSelection({
    selection: loaded.selection,
    role,
    requireBoundary: true,
  })
  const document = parseStructuredContent({ content: loaded.content, selection })
  const principle = getPath(document, ['pack', 'principle'])
  if (!safeText(principle)) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.METHOD_GUIDANCE_INVALID, {
      role,
      field: 'pack.principle',
    })
  }
  const parts = [principle]
  if (role === 'ARL') {
    const mustPreserve = requireStringArray(getPath(document, ['truth_binding_rules', 'must_preserve']), { role, field: 'truth_binding_rules.must_preserve' })
    const mustNot = requireStringArray(getPath(document, ['truth_binding_rules', 'must_not']), { role, field: 'truth_binding_rules.must_not' })
    const reasoningStages = getPath(document, ['reasoning_stages'])
    const safetyGates = getPath(document, ['safety_gates'])
    if (!Array.isArray(reasoningStages) || reasoningStages.length === 0
      || reasoningStages.some((stage) => !safeText(stage?.key) || !safeText(stage?.purpose))
      || !Array.isArray(safetyGates) || safetyGates.length === 0
      || safetyGates.some((gate) => !safeText(gate?.key) || !safeText(gate?.outcome))) {
      block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.METHOD_GUIDANCE_INVALID, {
        role,
        field: 'reasoning_stages_or_safety_gates',
      })
    }
    parts.push(...mustPreserve.map((value) => `Preserve: ${value}`))
    parts.push(...mustNot.map((value) => `Do not: ${value}`))
    parts.push(...(Array.isArray(reasoningStages)
      ? reasoningStages.map((stage) => `${safeText(stage?.key)}: ${safeText(stage?.purpose)}`).filter(Boolean)
      : []))
    parts.push(...(Array.isArray(safetyGates)
      ? safetyGates.map((gate) => `${safeText(gate?.key)}: ${safeText(gate?.outcome)}`).filter(Boolean)
      : []))
  } else {
    if (selectedFormat) {
      const exportRule = getPath(document, ['export_rules', selectedFormat])
      if (!isObject(exportRule)
        || exportRule.allowed !== true
        || exportRule.customer_content_only !== true) {
        block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.METHOD_GUIDANCE_INVALID, {
          role,
          field: `export_rules.${selectedFormat}`,
        })
      }
    }
    const mustInclude = requireStringArray(getPath(document, ['rendering_rules', 'must_include']), { role, field: 'rendering_rules.must_include' })
    const mustNot = requireStringArray(getPath(document, ['rendering_rules', 'must_not']), { role, field: 'rendering_rules.must_not' })
    const safeSections = requireStringArray(getPath(document, ['customer_safe_output', 'sections']), { role, field: 'customer_safe_output.sections' })
    requireStringArray(getPath(document, ['customer_safe_output', 'prohibited']), { role, field: 'customer_safe_output.prohibited' })
    parts.push(...mustInclude.map((value) => `Include: ${value}`))
    parts.push(...mustNot.map((value) => `Do not: ${value}`))
    parts.push(...safeSections.map((value) => `Section: ${value}`))
  }
  const guidance = projectProviderSafeText(parts.filter(Boolean).join('; '), {
    role,
    packKey: normalizeText(selection.packKey),
  })
  return {
    role,
    boundary: normalizeToken(selection.boundary),
    version: normalizeText(selection.semanticVersion),
    guidance: boundedText(guidance),
  }
}

const buildGovernanceConstraints = ({
  outputType,
  schema,
  arl,
  frameworkHandoff,
}) => {
  const claimBoundaries = Array.isArray(frameworkHandoff?.claimBoundaries)
    ? frameworkHandoff.claimBoundaries
    : []
  const claimBoundaryTypes = new Set(claimBoundaries.map((boundary) => normalizeText(boundary?.claimType)))
  const acceptedPolicy = FRAMEWORK_OUTCOME_CLAIM_TYPES.every((claimType) => claimBoundaryTypes.has(claimType))
    && claimBoundaries.every((boundary) => normalizeText(boundary?.policyVersion) === FRAMEWORK_OUTCOME_HANDOFF_POLICY_VERSION
      && normalizeText(boundary?.status) === 'BLOCKED_UNLESS_ACCEPTED_EVIDENCE_AND_BOUNDARY_PASS')
  if (!acceptedPolicy) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.GOVERNANCE_CONSTRAINTS_INVALID, {
      field: 'frameworkHandoff.claimBoundaries',
      expectedPolicyVersion: FRAMEWORK_OUTCOME_HANDOFF_POLICY_VERSION,
    })
  }
  const values = [
    ...outputType,
    ...collectStrings(schema?.governance?.globalRules?.must_not_introduce),
    ...collectStrings(schema?.governance?.globalRules?.hidden_from_customer),
    ...collectStrings(schema?.governance?.schemaProhibited),
    ...collectStrings(getPath(arl, ['truth_binding_rules', 'must_not'])),
    ...collectStrings(getPath(arl, ['customer_visible', 'prohibited'])),
    'Quantified, ROI, financial impact, customer proof, and named customer claims remain blocked unless accepted evidence and boundary pass.',
    'Hidden or internal instructions, raw source material, system-level instructions, and implementation details must not appear in customer-facing output.',
  ].map((value) => normalizeText(projectProviderSafeText(value, { field: 'governanceConstraints' }))
    .normalize('NFKC')
    .replace(/\s+/g, ' '))
  const deduplicated = new Map()
  values.filter(Boolean).forEach((value) => {
    const identity = value.toLocaleLowerCase('en')
    if (!deduplicated.has(identity)) deduplicated.set(identity, value)
  })
  const sorted = [...deduplicated.values()].sort((left, right) => (
    left.localeCompare(right, 'en', { sensitivity: 'base' }) || left.localeCompare(right, 'en')
  ))
  if (sorted.some((value) => value.length > 600)) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.GOVERNANCE_CONSTRAINTS_INVALID, {
      field: 'governanceConstraints.itemLength',
    })
  }
  const constraints = []
  sorted.forEach((value) => {
    const previous = constraints.at(-1)
    const grouped = previous ? `${previous}; ${value}` : value
    if (previous && grouped.length <= 600) constraints[constraints.length - 1] = grouped
    else constraints.push(value)
  })
  if (constraints.length > 16) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.GOVERNANCE_CONSTRAINTS_INVALID, {
      field: 'governanceConstraints.groupCount',
      observedCount: constraints.length,
      maximum: 16,
    })
  }
  if (constraints.length === 0) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.GOVERNANCE_CONSTRAINTS_INVALID, {
      field: 'governanceConstraints',
    })
  }
  return constraints
}

const getFrameworkStateProjection = ({ frameworkState = {}, frameworkHandoff = {} } = {}) => {
  const evidencePack = isObject(frameworkState.evidence_pack) ? frameworkState.evidence_pack : {}
  const lineage = isObject(evidencePack.lineage) ? evidencePack.lineage : {}
  const evidenceVersion = normalizeText(lineage.builder?.version)
  const sectionTruthVersion = normalizeText(frameworkHandoff.currentness?.sectionTruthHash)
  if (!evidenceVersion || !sectionTruthVersion) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.TRUTH_IDENTITY_MISSING, {
      missingFields: [
        ...(!evidenceVersion ? ['evidenceVersion'] : []),
        ...(!sectionTruthVersion ? ['sectionTruthVersion'] : []),
      ],
    })
  }
  return {
    ...frameworkState,
    evidence_pack: {
      ...evidencePack,
      evidenceVersion,
    },
    sectionTruthVersion,
  }
}

const buildTruthBinding = ({
  runtimeInstance,
  frameworkState,
  frameworkHandoff,
  truthSignature,
  sourceOutput,
} = {}) => {
  const evidence = isObject(truthSignature?.evidence) ? truthSignature.evidence : {}
  const lock = isObject(frameworkState.lock) ? frameworkState.lock : {}
  const eligibility = isObject(lock.outputEligibility) ? lock.outputEligibility : {}
  const snapshot = isObject(lock.snapshot) ? lock.snapshot : {}
  const replayAnchor = isObject(lock.replayAnchor) ? lock.replayAnchor : (isObject(lock.anchor) ? lock.anchor : {})
  const graph = isObject(frameworkState.intelligence_graph)
    ? frameworkState.intelligence_graph
    : (isObject(frameworkState.graph) ? frameworkState.graph : {})
  const evidencePack = frameworkState.evidence_pack || {}
  const lineage = evidencePack.lineage || {}
  const binding = {
    truthSignatureId: normalizeText(truthSignature?.truthSignatureId),
    status: normalizeToken(truthSignature?.status),
    currentness: normalizeToken(truthSignature?.currentness),
    runtimeInstanceId: normalizeText(runtimeInstance?._id || runtimeInstance?.id),
    runtimeInstanceKey: normalizeText(runtimeInstance?.runtimeInstanceKey),
    handoffHash: normalizeText(frameworkHandoff.currentness?.handoffHash),
    handoffStatus: normalizeToken(frameworkHandoff.status),
    handoffVersion: normalizeText(frameworkHandoff.contractVersion),
    sourceOutputAssetId: normalizeText(sourceOutput?.outputAssetId),
    sourceOutputTypeKey: normalizeToken(sourceOutput?.outputTypeKey),
    evidenceVersion: normalizeText(lineage.builder?.version),
    sectionTruthVersion: normalizeText(frameworkState.sectionTruthVersion),
    lockSnapshotId: normalizeText(evidence.lockSnapshotId || eligibility.snapshotId || snapshot.snapshotId),
    lockSnapshotHash: normalizeText(evidence.lockSnapshotHash || eligibility.snapshotHash || snapshot.snapshotHash),
    replayAnchorId: normalizeText(evidence.replayAnchorId || eligibility.replayAnchorId || replayAnchor.replayAnchorId || replayAnchor.anchorId),
    replayAnchorHash: normalizeText(evidence.replayAnchorHash || eligibility.replayAnchorHash || replayAnchor.replayAnchorHash || replayAnchor.anchorHash),
    graphVersion: normalizeText(evidence.graphVersion || graph.graphVersion || graph.version),
    graphHash: normalizeText(evidence.graphHash || graph.graphHash || graph.hash),
    unresolvedContradictionCount: Number(
      evidence.unresolvedContradictionCount
        ?? frameworkState.evidence_pack?.discoveryHealth?.unresolvedContradictionCount
        ?? 0,
    ),
    evidence: {
      ...evidence,
      runtimeInstanceId: normalizeText(runtimeInstance?._id || runtimeInstance?.id),
      runtimeInstanceKey: normalizeText(runtimeInstance?.runtimeInstanceKey),
      sourceOutputAssetId: normalizeText(sourceOutput?.outputAssetId),
      sourceOutputTypeKey: normalizeToken(sourceOutput?.outputTypeKey),
      evidenceVersion: normalizeText(lineage.builder?.version),
      sectionTruthVersion: normalizeText(frameworkState.sectionTruthVersion),
      handoffHash: normalizeText(frameworkHandoff.currentness?.handoffHash),
      frameworkHandoff: {
        ...(isObject(evidence.frameworkHandoff) ? evidence.frameworkHandoff : {}),
        status: normalizeToken(frameworkHandoff.status),
        handoffHash: normalizeText(frameworkHandoff.currentness?.handoffHash),
      },
    },
  }
  const missingFields = [
    'truthSignatureId',
    'status',
    'currentness',
    'runtimeInstanceId',
    'runtimeInstanceKey',
    'handoffHash',
    'handoffStatus',
    'sourceOutputAssetId',
    'sourceOutputTypeKey',
    'evidenceVersion',
    'sectionTruthVersion',
    'lockSnapshotId',
    'lockSnapshotHash',
    'replayAnchorId',
    'replayAnchorHash',
    'graphVersion',
    'graphHash',
  ].filter((field) => !normalizeText(binding[field]))
  if (missingFields.length > 0) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.TRUTH_IDENTITY_MISSING, { missingFields })
  }
  return binding
}

const buildKnowledgeContextForComposition = ({
  knowledgeContext,
  binding,
  outputType,
  schema,
  outputStructure,
  schemaProjection,
  styleSelection,
  loadedPacks,
} = {}) => {
  const lineage = isObject(knowledgeContext.lineage) ? knowledgeContext.lineage : {}
  const versionIds = unique([
    ...(Array.isArray(lineage.versionIds) ? lineage.versionIds : []),
    ...(Array.isArray(binding?.lineage?.versionIds) ? binding.lineage.versionIds : []),
    ...loadedPacks.map((pack) => pack.selection.versionId),
  ])
  const contentHashes = unique([
    ...(Array.isArray(lineage.contentHashes) ? lineage.contentHashes : []),
    ...(Array.isArray(binding?.lineage?.contentHashes) ? binding.lineage.contentHashes : []),
    ...loadedPacks.map((pack) => pack.contentHash),
  ])
  if (versionIds.length === 0 || contentHashes.length === 0) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTENT_UNAVAILABLE, {
      field: 'knowledgeContext.lineage',
    })
  }
  return {
    ...knowledgeContext,
    status: 'READY',
    available: true,
    outputType: {
      ...(knowledgeContext.outputType || {}),
      version: normalizeText(outputType.selection.semanticVersion),
    },
    outputTypeStructure: outputStructure,
    outputSchema: {
      ...(knowledgeContext.outputSchema || {}),
      key: normalizeKey(knowledgeContext.outputSchema?.key || schema.selection.capabilityKey),
      version: normalizeText(schema.selection.semanticVersion),
      requiredSections: schemaProjection.requiredSections,
      optionalSections: schemaProjection.optionalSections,
    },
    style: {
      ...(knowledgeContext.style || {}),
      version: normalizeText(styleSelection.semanticVersion || knowledgeContext.style?.version),
    },
    lineage: {
      ...lineage,
      versionIds,
      contentHashes,
    },
  }
}

export const buildOutcomeStudioLiveComposition = async ({
  runtimeInstance = {},
  frameworkState = runtimeInstance.framework_state || runtimeInstance.frameworkState || {},
  frameworkHandoff = {},
  knowledgeContextResult = {},
  knowledgeContext = knowledgeContextResult.context || {},
  binding = knowledgeContextResult.reasoningBinding,
  requestedOutputTypeKey = '',
  requestedFormat = '',
  userPrompt = '',
  truthSignature = {},
  sourceOutput = {},
  allowReadyWithGaps = false,
  loadPackContent = loadOutcomeKnowledgePackVersionContent,
  buildComposition = buildOutcomeStudioEvidenceComposition,
} = {}) => {
  if (typeof allowReadyWithGaps !== 'boolean') {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTEXT_BLOCKED, {
      field: 'allowReadyWithGaps',
    })
  }
  const contextStatus = normalizeToken(knowledgeContext?.status)
  const bindingStatus = normalizeToken(binding?.status)
  const handoffStatus = normalizeToken(frameworkHandoff?.status)
  const readinessStatuses = [contextStatus, bindingStatus, handoffStatus]
  const hasReadyWithGaps = readinessStatuses.includes('READY_WITH_GAPS')
  const hasUnsupportedReadinessStatus = readinessStatuses.some(
    (status) => !['READY', 'READY_WITH_GAPS'].includes(status),
  )
  const hasBlockingDiagnostics = [
    knowledgeContext?.blockers,
    binding?.blockers,
    frameworkHandoff?.blockers,
  ].some((blockers) => Array.isArray(blockers) && blockers.length > 0)
  if (hasReadyWithGaps && !allowReadyWithGaps) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.READY_WITH_GAPS_BLOCKED, {
      contextStatus,
      bindingStatus,
      handoffStatus,
      warnings: [
        ...(Array.isArray(knowledgeContext?.warnings) ? knowledgeContext.warnings : []),
        ...(Array.isArray(binding?.warnings)
          ? binding.warnings.map((warning) => normalizeText(warning?.message || warning)).filter(Boolean)
          : []),
        ...(Array.isArray(frameworkHandoff?.warnings) ? frameworkHandoff.warnings : []),
        ...(Array.isArray(frameworkHandoff?.customerSafe?.warnings)
          ? frameworkHandoff.customerSafe.warnings
          : []),
      ],
      gaps: Array.isArray(frameworkHandoff?.gaps) ? frameworkHandoff.gaps : [],
      nextAction: normalizeText(
        knowledgeContext?.nextAction
          || frameworkHandoff?.customerSafe?.nextAction
          || frameworkHandoff?.nextAction,
      ),
    })
  }
  if (hasUnsupportedReadinessStatus
    || knowledgeContext?.available !== true
    || hasBlockingDiagnostics
    || !['READY', 'READY_WITH_GAPS'].includes(contextStatus)
    || !['READY', 'READY_WITH_GAPS'].includes(bindingStatus)
    || !['READY', 'READY_WITH_GAPS'].includes(handoffStatus)) {
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.KNOWLEDGE_CONTEXT_BLOCKED, {
      contextStatus,
      bindingStatus,
      handoffStatus,
    })
  }

  const readiness = {
    status: hasReadyWithGaps ? 'READY_WITH_GAPS' : 'READY',
    draftOnly: hasReadyWithGaps,
    gapCount: hasReadyWithGaps
      ? Math.min(24, Math.max(
        1,
        readinessStatuses.filter((status) => status === 'READY_WITH_GAPS').length
          + (Array.isArray(frameworkHandoff?.gaps) ? frameworkHandoff.gaps.length : 0),
      ))
      : 0,
    notice: hasReadyWithGaps
      ? 'This draft uses current governed information with unresolved source or framework gaps. Keep unsupported claims qualified and do not treat this draft as final.'
      : '',
  }

  const outputSelection = findPackSelection({
    binding,
    packKey: normalizeText(knowledgeContext.outputType?.key || requestedOutputTypeKey),
    layer: 'OUTPUT_TYPE',
    capabilityKey: requestedOutputTypeKey,
  })
  const schemaSelection = findPackSelection({
    binding,
    packKey: normalizeText(knowledgeContext.outputSchema?.key),
    layer: 'OUTPUT_SCHEMA',
    capabilityKey: knowledgeContext.outputSchema?.key,
  })
  const styleSelection = findPackSelection({
    binding,
    packKey: normalizeText(knowledgeContext.style?.key),
    layer: 'STYLE',
    capabilityKey: knowledgeContext.style?.key,
  })
  const arlSelection = findPackSelection({
    binding,
    packKey: ROLE_REGISTRY.ARL.packKey,
    layer: 'REASONING',
  })
  const rlSelection = findPackSelection({
    binding,
    packKey: ROLE_REGISTRY.RL.packKey,
    layer: 'COMMUNICATION_PATTERN',
  })

  const [outputType, schema, arl, rl] = await Promise.all([
    loadSelectedContent({ selection: outputSelection, binding, loadPackContent }),
    loadSelectedContent({ selection: schemaSelection, binding, loadPackContent }),
    loadSelectedContent({ selection: arlSelection, binding, loadPackContent }),
    loadSelectedContent({ selection: rlSelection, binding, loadPackContent }),
  ])
  const outputStructure = resolveOutputStructure({
    content: outputType.content,
    selection: outputType.selection,
    requestedOutputTypeKey,
  })
  const outputGovernance = resolveOutputTypeGovernance({
    content: outputType.content,
    selection: outputType.selection,
  })
  const schemaProjection = resolveSchemaProjection({
    content: schema.content,
    selection: schema.selection,
    schemaKey: knowledgeContext.outputSchema.key,
  })
  const arlDocument = parseStructuredContent({ content: arl.content, selection: arl.selection })
  const arlGuidance = buildMethodGuidance({ role: 'ARL', loaded: arl })
  const rlGuidance = buildMethodGuidance({ role: 'RL', loaded: rl, selectedFormat: normalizeToken(requestedFormat) })
  const methodGuidance = [arlGuidance]
  const methodPackBindings = [arlGuidance, rlGuidance].map(({ role, boundary, version }) => ({
    role,
    boundary,
    version,
  }))
  const governanceConstraints = buildGovernanceConstraints({
    outputType: outputGovernance,
    schema: schemaProjection,
    arl: arlDocument,
    frameworkHandoff,
  })
  const projectedFrameworkState = getFrameworkStateProjection({ frameworkState, frameworkHandoff })
  const projectedTruthBinding = buildTruthBinding({
    runtimeInstance,
    frameworkState: projectedFrameworkState,
    frameworkHandoff,
    truthSignature,
    sourceOutput,
  })
  let compositionPackage
  try {
    compositionPackage = buildComposition({
      runtimeInstance,
      frameworkState: projectedFrameworkState,
      truthBinding: projectedTruthBinding,
      knowledgeContext: buildKnowledgeContextForComposition({
        knowledgeContext,
        binding,
        outputType,
        schema,
        outputStructure,
        schemaProjection,
        styleSelection,
        loadedPacks: [outputType, schema, arl, rl],
      }),
      requestedOutputTypeKey,
      userPrompt,
    })
  } catch (error) {
    if (error?.code === 'OUTCOME_STUDIO_COMPOSITION_BLOCKED') throw error
    block(OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS.COMPOSITION_FAILED, {
      cause: error.message,
    })
  }
  compositionPackage = {
    ...compositionPackage,
    readiness,
  }
  const consumption = buildOutcomeStudioGenerationContextConsumption({
    compositionPackage,
    directBindings: [
      { role: 'OUTPUT_TYPE', versionId: outputType.selection.versionId, contentHash: outputType.contentHash },
      { role: 'OUTPUT_SCHEMA', versionId: schema.selection.versionId, contentHash: schema.contentHash },
      { role: 'ARL', versionId: arl.selection.versionId, contentHash: arl.contentHash },
    ],
    methodGuidance,
  })
  return {
    contractVersion: OUTCOME_STUDIO_LIVE_COMPOSITION_BRIDGE_CONTRACT,
    compositionPackage,
    methodGuidance,
    methodPackBindings,
    governanceConstraints,
    readiness,
    readinessSources: {
      knowledgeContext: contextStatus,
      reasoningBinding: bindingStatus,
      frameworkHandoff: handoffStatus,
    },
    ...consumption,
    truthBinding: projectedTruthBinding,
    knowledgeProjection: {
      outputTypeVersion: outputType.selection.semanticVersion,
      outputSchemaVersion: schema.selection.semanticVersion,
      styleVersion: styleSelection.semanticVersion || knowledgeContext.style?.version,
      versionIds: unique([outputType, schema, arl, rl].map((pack) => pack.selection.versionId)),
      contentHashes: unique([outputType, schema, arl, rl].map((pack) => pack.contentHash)),
    },
  }
}

export default {
  buildOutcomeStudioLiveComposition,
  OUTCOME_STUDIO_LIVE_COMPOSITION_BLOCKERS,
  OUTCOME_STUDIO_LIVE_COMPOSITION_BRIDGE_CONTRACT,
}
