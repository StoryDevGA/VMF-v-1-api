import { OUTCOME_KNOWLEDGE_PACK_TYPES } from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_ASSET_ID_PATTERN, KNOWLEDGE_PACK_LAYERS,
  KNOWLEDGE_PACK_PURPOSE_CATEGORIES, KNOWLEDGE_PACK_EXECUTION_MODES,
  KNOWLEDGE_PACK_VISIBILITY_SCOPES,
} from '../constants/knowledgeRuntime.js'
import { WORKSPACE_TYPES } from '../constants/workspaceGovernance.js'
import { parseKnowledgePackFrontMatter } from './knowledgePackRelationshipContract.js'

// Import descriptions only. These fields never manufacture executable relationships.
const fields = {
  label: { aliases: ['name', 'title', 'label'], max: 160, required: true },
  knowledgeAssetId: { aliases: ['knowledge_asset_id', 'knowledgeAssetId'], pattern: KNOWLEDGE_ASSET_ID_PATTERN, required: true },
  capabilityKey: { aliases: ['capability_key', 'capabilityKey'], pattern: /^[a-z][a-z0-9-]{1,139}$/, required: true },
  packType: { aliases: ['draft_pack_type', 'pack_type', 'packType'], values: Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES), required: true },
  purposeCategory: { aliases: ['purpose_category', 'purposeCategory'], values: Object.values(KNOWLEDGE_PACK_PURPOSE_CATEGORIES) },
  knowledgeLayer: { aliases: ['knowledge_layer', 'knowledgeLayer'], values: Object.values(KNOWLEDGE_PACK_LAYERS), required: true },
  executionMode: { aliases: ['execution_mode', 'executionMode'], values: Object.values(KNOWLEDGE_PACK_EXECUTION_MODES) },
  visibility: { aliases: ['visibility'], values: Object.values(KNOWLEDGE_PACK_VISIBILITY_SCOPES) },
  workspaceCompatibility: { aliases: ['workspace_compatibility', 'workspaceCompatibility'], array: true, values: Object.values(WORKSPACE_TYPES), required: true },
  runtimeConsumers: { aliases: ['runtime_consumers', 'runtimeConsumers'], array: true, max: 160 },
  description: { aliases: ['description'], max: 1000 },
}
export const IMPORT_METADATA_FIELDS = Object.freeze(Object.keys(fields))
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const same = (a, b) => JSON.stringify(Array.isArray(a) ? [...a].sort() : typeof a === 'string' ? a.trim() : a)
  === JSON.stringify(Array.isArray(b) ? [...b].sort() : typeof b === 'string' ? b.trim() : b)

function validValue(value, rule) {
  if (rule.array) {
    return Array.isArray(value) && value.length <= 100
      && (!rule.required || value.length > 0)
      && new Set(value).size === value.length
      && value.every((item) => typeof item === 'string' && item.trim().length > 0
        && item.length <= (rule.max || 160) && (!rule.values || rule.values.includes(item)))
  }
  return typeof value === 'string' && (!rule.required || value.trim().length > 0)
    && value.length <= (rule.max || 160)
    && (!rule.values || rule.values.includes(value))
    && (!rule.pattern || rule.pattern.test(value))
}

export function previewKnowledgePackImportMetadata({ extractedText = '', metadata, metadataOverrides = [] } = {}, { requireComplete = true } = {}) {
  const fieldErrors = {}
  const sourceMetadata = {}
  let raw = {}
  if (typeof extractedText !== 'string' || extractedText.length > 750000) {
    return { metadata: {}, sourceMetadata, fieldErrors: { extractedText: 'Select a readable source with at most 750000 characters.' } }
  }
  try {
    // A document without a header can be completed manually. A malformed header cannot.
    if (/^(?:\uFEFF)?---/.test(extractedText)) {
      const parsed = parseKnowledgePackFrontMatter(extractedText, { packType: 'OUTPUT_SCHEMA' })
      raw = parsed.declaredMetadata
    }
  } catch (err) {
    return { metadata: {}, sourceMetadata, fieldErrors: { extractedText: `${err.message} Correct the source file and select it again.` } }
  }
  for (const [key, rule] of Object.entries(fields)) {
    const declared = rule.aliases.filter((alias) => own(raw, alias))
    if (!declared.length) continue
    const values = declared.map((alias) => raw[alias])
    if (values.some((value) => !validValue(value, rule))) {
      fieldErrors[key] = `Invalid ${rule.aliases[0]} in the source. ${rule.array ? 'Use an array of unique valid strings.' : rule.values ? 'Use a supported enum value.' : 'Use a valid text value.'} Correct the file and select it again.`
    } else if (values.some((value) => !same(value, values[0]))) {
      fieldErrors[key] = `Conflicting source fields: ${declared.join(', ')}. Correct the file and select it again.`
    } else sourceMetadata[key] = values[0]
  }
  const result = { ...sourceMetadata }
  if (!Array.isArray(metadataOverrides) || metadataOverrides.some((key) => !IMPORT_METADATA_FIELDS.includes(key))) {
    fieldErrors.metadataOverrides = 'Overrides must name known import metadata fields.'
  }
  for (const [key, rule] of Object.entries(fields)) {
    if (metadata && own(metadata, key)) {
      const value = metadata[key]
      if (!validValue(value, rule)) {
        fieldErrors[key] ||= `Enter a valid ${rule.aliases[0]}${rule.array ? ' array' : ''}${rule.values ? ' using a supported enum value' : ''}.`
      } else if (own(sourceMetadata, key) && !same(value, sourceMetadata[key])
        && (key === 'knowledgeAssetId' || !Array.isArray(metadataOverrides) || !metadataOverrides.includes(key))) {
        fieldErrors[key] ||= key === 'knowledgeAssetId'
          ? 'Knowledge Asset ID must match the selected source.'
          : `${rule.aliases[0]} conflicts with the source. Explicitly edit this field to confirm an override.`
      } else result[key] = value
    }
    if (requireComplete && rule.required && !own(result, key)) fieldErrors[key] ||= `${rule.aliases[0]} is missing. Enter it before creating the draft.`
  }
  if (raw.compatible_output_types !== undefined && result.packType !== 'OUTPUT_SCHEMA') {
    fieldErrors.packType = 'compatible_output_types is valid only for OUTPUT_SCHEMA packs.'
  }
  return { metadata: result, sourceMetadata, fieldErrors }
}

export function assertKnowledgePackImportMetadata(body) {
  const result = previewKnowledgePackImportMetadata({
    extractedText: body.extractedText,
    metadata: Object.fromEntries(IMPORT_METADATA_FIELDS.filter((key) => own(body, key)).map((key) => [key, body[key]])),
    metadataOverrides: body.metadataOverrides,
  }, { requireComplete: false }) // Existing canonical-pack inheritance owns missing governance fields on creation.
  if (Object.keys(result.fieldErrors).length) {
    throw Object.assign(new Error('Resolve the source metadata errors before creating the draft.'), {
      status: 422, code: 'VALIDATION_FAILED',
      details: { reason: 'MISSING_GOVERNANCE_METADATA', ...result.fieldErrors },
    })
  }
  return result
}
