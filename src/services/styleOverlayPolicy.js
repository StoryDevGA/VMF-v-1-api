import { createHash } from 'node:crypto'
import { parseKnowledgePackFrontMatter } from './knowledgePackRelationshipContract.js'
import { resolveOutcomeStudioAssetRenderer } from './outcomeStudioAssetRenderingService.js'

export const STYLE_OVERLAY_POLICY_VERSION = 'style-overlay.default-compatible.v1'
export const STYLE_OVERLAY_CONSTRAINT_VERSION = 'style-overlay.constraints.v1'
const fields = ['contractVersion', 'incompatibleOutputTypes', 'incompatibleAudienceKeys', 'requiredRendererCapabilities']
const descriptorFields = ['packType', 'packId', 'packKey', 'versionId', 'semanticVersion', 'contentHash']
const text = value => typeof value === 'string' ? value.trim() : ''
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = reason => { throw Object.assign(new TypeError('The selected style overlay cannot be applied.'), {
  code: 'STYLE_OVERLAY_INVALID', status: 409, details: { reason },
}) }
const descriptor = pack => Object.fromEntries(descriptorFields.map(key => [key, text(pack?.[key])]))

export const normalizeStyleOverlayConstraints = value => {
  if (value === undefined) return { contractVersion: STYLE_OVERLAY_CONSTRAINT_VERSION,
    incompatibleOutputTypes: [], incompatibleAudienceKeys: [], requiredRendererCapabilities: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))
    || value.contractVersion !== STYLE_OVERLAY_CONSTRAINT_VERSION) fail('STYLE_CONSTRAINTS_INVALID')
  const result = { contractVersion: STYLE_OVERLAY_CONSTRAINT_VERSION }
  for (const key of fields.slice(1)) {
    if (!Array.isArray(value[key]) || value[key].length > 50
      || value[key].some(entry => typeof entry !== 'string' || entry !== entry.trim()
        || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,139}$/.test(entry))
      || new Set(value[key].map(entry => entry.toLowerCase())).size !== value[key].length) fail('STYLE_CONSTRAINTS_INVALID')
    result[key] = [...value[key]].sort()
  }
  return result
}

// Only exact active version content owns declarations. A positive historical
// COMPATIBLE_WITH list is not an exclusion list under this prospective policy.
export const readStyleOverlayConstraints = ({ source, content, contentFormat }) => {
  if (source?.packType !== 'STYLE' || typeof content !== 'string'
    || Buffer.byteLength(content, 'utf8') > 200000
    || `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}` !== source.contentHash) fail('STYLE_SOURCE_HASH_MISMATCH')
  let metadata = {}
  try {
    if (contentFormat === 'JSON') metadata = JSON.parse(content)
    else if (['YAML', 'YML'].includes(contentFormat)) metadata = parseKnowledgePackFrontMatter(`---\n${content}\n---`, { packType: 'STYLE' }).declaredMetadata
    else if (contentFormat === 'MARKDOWN') {
      if (/^(?:\uFEFF)?---(?:\r?\n)/.test(content)) metadata = parseKnowledgePackFrontMatter(content, { packType: 'STYLE' }).declaredMetadata
    } else fail('STYLE_SOURCE_FORMAT_UNSUPPORTED')
  } catch { fail('STYLE_SOURCE_DECLARATION_INVALID') }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail('STYLE_SOURCE_DECLARATION_INVALID')
  return normalizeStyleOverlayConstraints(metadata.styleConstraints)
}

export const evaluateStyleOverlayEligibility = ({ style, outputType, schema, audienceKeys = [],
  constraints = style?.styleConstraints, format = '' }) => {
  if (style?.packType !== 'STYLE' || (style.status || style.lifecycleStatus) !== 'ACTIVE') fail('STYLE_NOT_ACTIVE')
  if (!outputType?.packKey || !schema?.packKey || !style.packKey) fail('STYLE_CONTRACT_MISSING')
  if (!Array.isArray(audienceKeys) || audienceKeys.some(key => !text(key))) fail('STYLE_AUDIENCE_CONTEXT_INVALID')
  const normalized = normalizeStyleOverlayConstraints(constraints)
  const targets = [outputType.packKey, outputType.knowledgeAssetId].filter(Boolean).map(value => value.toLowerCase())
  if (normalized.incompatibleOutputTypes.some(value => targets.includes(value.toLowerCase()))) fail('STYLE_OUTPUT_EXPLICITLY_INCOMPATIBLE')
  if (normalized.incompatibleAudienceKeys.some(value => audienceKeys.some(key => key.toLowerCase() === value.toLowerCase()))) fail('STYLE_AUDIENCE_EXPLICITLY_INCOMPATIBLE')
  let renderer = null
  if (format) {
    // The real registry owns capabilities; no request-supplied capability list.
    const entry = resolveOutcomeStudioAssetRenderer({ format, outputContract: {
      outputTypeKey: outputType.packKey, outputSchemaKey: schema.packKey, styleKey: style.packKey,
    } })
    if (normalized.requiredRendererCapabilities.some(capability => !entry.supportedComponents.includes(capability))) fail('STYLE_RENDERER_CAPABILITY_MISSING')
    renderer = { format: entry.format, adapterKey: entry.adapterKey, templateKey: entry.templateKey,
      supportedComponents: [...entry.supportedComponents] }
  }
  return { policyVersion: STYLE_OVERLAY_POLICY_VERSION,
    status: renderer ? 'ELIGIBLE_PENDING_CONTENT_AND_RL_VALIDATION' : 'ELIGIBLE_PENDING_RENDERER_AND_CONTENT_VALIDATION',
    outputType: descriptor(outputType), schema: descriptor(schema), style: descriptor(style),
    outputAssetId: text(outputType.knowledgeAssetId),
    constraints: normalized, constraintsHash: digest(normalized), audienceKeys: [...audienceKeys], renderer,
    contentValidated: false, rlApproved: false }
}

export const assertStyleOverlaySourceEligibility = ({ style, outputType, schema, audienceKeys, format, loaded }) => {
  if (!loaded?.available || loaded.status !== 'ACTIVE'
    || descriptorFields.filter(key => key !== 'packType').some(key => loaded[key] !== style[key])) fail('STYLE_SOURCE_BINDING_MISMATCH')
  const constraints = readStyleOverlayConstraints({ source: style, content: loaded.content, contentFormat: loaded.contentFormat })
  return evaluateStyleOverlayEligibility({ style, outputType, schema, audienceKeys, format, constraints })
}
