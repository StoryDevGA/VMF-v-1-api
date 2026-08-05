import crypto from 'crypto'
import semver from 'semver'
import { parseDocument } from 'yaml'

import { OUTCOME_KNOWLEDGE_PACK_TYPES } from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_LAYERS,
  KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES,
  KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
  KNOWLEDGE_PACK_RELATIONSHIP_FAILURES,
  KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS,
  KNOWLEDGE_PACK_RELATIONSHIP_TYPES,
} from '../constants/knowledgeRuntime.js'

const MAX_FRONT_MATTER_BYTES = 64 * 1024
const MAX_DEPTH = 12
const MAX_SCALAR_LENGTH = 8 * 1024
const MAX_RELATIONSHIPS = 100
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const IDENTITY_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/
const EXECUTABLE_TOP_LEVEL_KEYS = new Set([
  'relationshipContractVersion',
  'knowledge_asset_id',
  'dependencyReferences',
  'compatible_output_types',
])

const normalizeText = (value) => String(value ?? '').normalize('NFKC').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()
const compactObject = (value) => Object.fromEntries(
  Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ''),
)

export class KnowledgePackRelationshipContractError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'KnowledgePackRelationshipContractError'
    this.code = KNOWLEDGE_PACK_RELATIONSHIP_FAILURES.MISSING_GOVERNANCE_METADATA
    this.statusCode = 422
    this.details = details
  }
}

const fail = (message, details = {}) => {
  throw new KnowledgePackRelationshipContractError(message, details)
}

export const normalizeKnowledgeAssetId = (value, { required = false } = {}) => {
  const normalized = normalizeToken(value)
  if (!normalized) {
    if (required) fail('knowledgeAssetId is required.', { field: 'knowledgeAssetId' })
    return ''
  }
  if (normalized.length > 128 || !IDENTITY_PATTERN.test(normalized)) {
    fail('knowledgeAssetId must be a governed uppercase hyphenated identity.', {
      field: 'knowledgeAssetId',
      observedValue: normalized,
    })
  }
  return normalized
}

const normalizeVersionConstraint = (value) => {
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('versionConstraint must be an object.', { field: 'versionConstraint' })
  }
  const exactVersion = normalizeText(value.exactVersion)
  const minimumVersionInclusive = normalizeText(value.minimumVersionInclusive)
  const maximumVersionExclusive = normalizeText(value.maximumVersionExclusive)
  if (exactVersion && (minimumVersionInclusive || maximumVersionExclusive)) {
    fail('versionConstraint cannot mix exact and range fields.', { field: 'versionConstraint' })
  }
  if (!exactVersion && !minimumVersionInclusive && !maximumVersionExclusive) {
    fail('versionConstraint must contain an exact or bounded semantic version.', {
      field: 'versionConstraint',
    })
  }
  for (const [field, version] of Object.entries({
    exactVersion,
    minimumVersionInclusive,
    maximumVersionExclusive,
  })) {
    if (version && !semver.valid(version)) {
      fail(`${field} must be a valid semantic version.`, { field, observedValue: version })
    }
  }
  if (
    minimumVersionInclusive
    && maximumVersionExclusive
    && !semver.lt(minimumVersionInclusive, maximumVersionExclusive)
  ) {
    fail('minimumVersionInclusive must be less than maximumVersionExclusive.', {
      field: 'versionConstraint',
    })
  }
  return compactObject({ exactVersion, minimumVersionInclusive, maximumVersionExclusive })
}

const invariantByType = Object.freeze({
  [KNOWLEDGE_PACK_RELATIONSHIP_TYPES.REQUIRED_AT_ACTIVATION]: {
    timing: KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS.ACTIVATION,
    cardinalities: new Set([
      KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ONE,
      KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ONE_OR_MORE,
    ]),
    selector: 'EXACT',
  },
  [KNOWLEDGE_PACK_RELATIONSHIP_TYPES.REQUIRED_AT_RUNTIME]: {
    timing: KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS.RUNTIME,
    cardinalities: new Set([
      KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ONE,
      KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ONE_OR_MORE,
    ]),
    selector: 'EXACT',
  },
  [KNOWLEDGE_PACK_RELATIONSHIP_TYPES.OPTIONAL]: {
    timing: KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS.RUNTIME,
    cardinalities: new Set([
      KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ZERO_OR_ONE,
      KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ZERO_OR_MORE,
    ]),
    selector: 'EXACT',
  },
  [KNOWLEDGE_PACK_RELATIONSHIP_TYPES.COMPATIBLE_WITH]: {
    timing: KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS.NONE,
    cardinalities: new Set([KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ZERO_OR_MORE]),
    selector: 'ASSET_ONLY',
  },
  [KNOWLEDGE_PACK_RELATIONSHIP_TYPES.SUPERSEDES]: {
    timing: KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS.NONE,
    cardinalities: new Set([KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ZERO_OR_MORE]),
    selector: 'ASSET_OR_PACK',
  },
  [KNOWLEDGE_PACK_RELATIONSHIP_TYPES.REFERENCES]: {
    timing: KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS.NONE,
    cardinalities: new Set([KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ZERO_OR_MORE]),
    selector: 'EXACT',
  },
  [KNOWLEDGE_PACK_RELATIONSHIP_TYPES.REQUIRES_COMPATIBLE_PACK]: {
    timing: KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS.RUNTIME,
    cardinalities: new Set([KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ONE_OR_MORE]),
    selector: 'TYPE_ONLY',
  },
})

const assertSelectorInvariant = (relationship, selectorRule) => {
  const exactSelectors = [
    relationship.targetPackKey,
    relationship.targetCapabilityKey,
    relationship.targetKnowledgeAssetId,
  ].filter(Boolean)
  if (relationship.targetPackKey && !relationship.targetPackType) {
    fail('targetPackKey requires targetPackType.', { relationship })
  }
  if (exactSelectors.length > 1) {
    fail('Relationship must not contain more than one exact selector.', { relationship })
  }
  if (selectorRule === 'EXACT' && exactSelectors.length !== 1) {
    fail('Relationship requires exactly one exact selector.', { relationship })
  }
  if (
    selectorRule === 'ASSET_ONLY'
    && (!relationship.targetKnowledgeAssetId || exactSelectors.length !== 1)
  ) {
    fail('COMPATIBLE_WITH requires only targetKnowledgeAssetId as its exact selector.', {
      relationship,
    })
  }
  if (
    selectorRule === 'ASSET_OR_PACK'
    && exactSelectors.length !== 1
    || selectorRule === 'ASSET_OR_PACK'
      && Boolean(relationship.targetCapabilityKey)
  ) {
    fail('SUPERSEDES requires targetKnowledgeAssetId or targetPackKey.', { relationship })
  }
  if (
    selectorRule === 'TYPE_ONLY'
    && (!relationship.targetPackType || exactSelectors.length !== 0)
  ) {
    fail('REQUIRES_COMPATIBLE_PACK requires targetPackType and forbids an exact target.', {
      relationship,
    })
  }
}

export const normalizeKnowledgePackRelationship = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Knowledge Pack relationship must be an object.')
  }
  const legacyFields = ['requirement', 'packType', 'packKey', 'capabilityKey', 'knowledgeLayer']
    .filter((field) => Object.prototype.hasOwnProperty.call(value, field))
  if (legacyFields.length > 0) {
    fail('Legacy dependency metadata requires the guarded SS-002 migration.', { legacyFields })
  }
  const relationshipType = normalizeToken(value.relationshipType)
  const invariant = invariantByType[relationshipType]
  if (!invariant) fail('relationshipType is unsupported.', { relationshipType })
  const relationship = compactObject({
    relationshipType,
    targetPackType: normalizeToken(value.targetPackType),
    targetPackKey: normalizeLowerKey(value.targetPackKey),
    targetCapabilityKey: normalizeLowerKey(value.targetCapabilityKey),
    targetKnowledgeAssetId: normalizeKnowledgeAssetId(value.targetKnowledgeAssetId),
    targetKnowledgeLayer: normalizeToken(value.targetKnowledgeLayer),
    requiredAt: normalizeToken(value.requiredAt),
    cardinality: normalizeToken(value.cardinality),
    versionConstraint: normalizeVersionConstraint(value.versionConstraint),
  })
  if (!Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES).includes(relationship.targetPackType)) {
    if (relationship.targetPackType) {
      fail('targetPackType is unsupported.', { relationship })
    }
  }
  if (!Object.values(KNOWLEDGE_PACK_LAYERS).includes(relationship.targetKnowledgeLayer)) {
    if (relationship.targetKnowledgeLayer) {
      fail('targetKnowledgeLayer is unsupported.', { relationship })
    }
  }
  if (relationship.requiredAt !== invariant.timing) {
    fail('Relationship timing does not match relationshipType.', { relationship })
  }
  if (!invariant.cardinalities.has(relationship.cardinality)) {
    fail('Relationship cardinality does not match relationshipType.', { relationship })
  }
  assertSelectorInvariant(relationship, invariant.selector)
  return relationship
}

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  )
}

const stableStringify = (value) => JSON.stringify(stableValue(value))

export const normalizeKnowledgePackRelationships = (values, { required = false } = {}) => {
  if (values === undefined) {
    if (required) fail('dependencyReferences are required.', { field: 'dependencyReferences' })
    return []
  }
  if (!Array.isArray(values)) fail('dependencyReferences must be an array.')
  if (values.length > MAX_RELATIONSHIPS) {
    fail(`dependencyReferences can contain at most ${MAX_RELATIONSHIPS} entries.`)
  }
  const normalized = values.map(normalizeKnowledgePackRelationship)
  const byCanonicalValue = new Map()
  for (const relationship of normalized) {
    const key = stableStringify(relationship)
    if (byCanonicalValue.has(key)) fail('Duplicate canonical relationship.', { relationship })
    byCanonicalValue.set(key, relationship)
  }
  return [...byCanonicalValue.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, relationship]) => relationship)
}

export const buildKnowledgePackRelationshipChecksum = (relationships = []) => crypto
  .createHash('sha256')
  .update(stableStringify(normalizeKnowledgePackRelationships(relationships)))
  .digest('hex')

export const semanticVersionSatisfies = (version, constraint) => {
  const normalizedVersion = semver.valid(normalizeText(version))
  if (!normalizedVersion) return false
  const normalized = normalizeVersionConstraint(constraint)
  if (!normalized) return true
  if (normalized.exactVersion) return semver.eq(normalizedVersion, normalized.exactVersion)
  if (
    normalized.minimumVersionInclusive
    && semver.lt(normalizedVersion, normalized.minimumVersionInclusive)
  ) return false
  if (
    normalized.maximumVersionExclusive
    && !semver.lt(normalizedVersion, normalized.maximumVersionExclusive)
  ) return false
  return true
}

export const evaluateRelationshipCardinality = (cardinality, count) => {
  const normalized = normalizeToken(cardinality)
  const observedCount = Number(count)
  const success = (
    (normalized === KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ONE && observedCount === 1)
    || (normalized === KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ZERO_OR_ONE && observedCount <= 1)
    || (normalized === KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ONE_OR_MORE && observedCount >= 1)
    || (normalized === KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ZERO_OR_MORE && observedCount >= 0)
  )
  return { cardinality: normalized, observedCount, success }
}

const inspectParsedValue = (value, depth = 0, seen = new Set()) => {
  if (depth > MAX_DEPTH) fail(`Front matter exceeds maximum depth ${MAX_DEPTH}.`)
  if (typeof value === 'string' && value.length > MAX_SCALAR_LENGTH) {
    fail(`Front-matter scalar exceeds ${MAX_SCALAR_LENGTH} characters.`)
  }
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) fail('Cyclic front-matter values are forbidden.')
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((entry) => inspectParsedValue(entry, depth + 1, seen))
  } else {
    for (const [key, entry] of Object.entries(value)) {
      if (UNSAFE_KEYS.has(key)) fail('Unsafe front-matter key is forbidden.', { key })
      inspectParsedValue(entry, depth + 1, seen)
    }
  }
  seen.delete(value)
}

const extractFrontMatter = (source) => {
  const text = String(source ?? '').normalize('NFKC').replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines[0] !== '---') fail('Source front matter must start with a standalone --- line.')
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === '---')
  if (closingIndex < 0) fail('Source front matter must end with a standalone --- line.')
  if (lines.slice(closingIndex + 1).some((line) => line === '---' || line === '...')) {
    fail('Multiple YAML documents or front-matter envelopes are forbidden.')
  }
  const yamlText = lines.slice(1, closingIndex).join('\n')
  if (Buffer.byteLength(yamlText, 'utf8') > MAX_FRONT_MATTER_BYTES) {
    fail(`Front matter exceeds ${MAX_FRONT_MATTER_BYTES} bytes.`)
  }
  if (/(^|\s)[&*!][^\s]+|(^|\s)<<\s*:/m.test(yamlText)) {
    fail('YAML aliases, anchors, explicit tags and merge keys are forbidden.')
  }
  return yamlText
}

export const parseKnowledgePackFrontMatter = (source, { packType = '' } = {}) => {
  const yamlText = extractFrontMatter(source)
  const document = parseDocument(yamlText, {
    schema: 'core',
    customTags: [],
    uniqueKeys: true,
    maxAliasCount: 0,
    prettyErrors: false,
  })
  if (document.errors.length > 0) {
    fail('Knowledge Pack front matter is invalid YAML.', {
      parserErrors: document.errors.map((error) => error.message),
    })
  }
  const metadata = document.toJS({ maxAliasCount: 0 })
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('Knowledge Pack front matter must be a mapping.')
  }
  inspectParsedValue(metadata)

  const knowledgeAssetId = normalizeKnowledgeAssetId(metadata.knowledge_asset_id, {
    required: true,
  })
  const relationshipContractVersion = normalizeToken(metadata.relationshipContractVersion)
  let dependencyReferences = metadata.dependencyReferences

  if (metadata.compatible_output_types !== undefined) {
    if (normalizeToken(packType) !== 'OUTPUT_SCHEMA') {
      fail('compatible_output_types is valid only for OUTPUT_SCHEMA packs.')
    }
    if (!Array.isArray(metadata.compatible_output_types)) {
      fail('compatible_output_types must be an array.')
    }
    if (metadata.compatible_output_types.length > MAX_RELATIONSHIPS) {
      fail(`compatible_output_types can contain at most ${MAX_RELATIONSHIPS} entries.`)
    }
    const compatibilityRelationships = metadata.compatible_output_types.map((entry) => ({
      relationshipType: KNOWLEDGE_PACK_RELATIONSHIP_TYPES.COMPATIBLE_WITH,
      targetKnowledgeAssetId: typeof entry === 'string' ? entry : entry?.knowledge_asset_id,
      requiredAt: KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS.NONE,
      cardinality: KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES.ZERO_OR_MORE,
    }))
    dependencyReferences = [
      ...(Array.isArray(dependencyReferences) ? dependencyReferences : []),
      ...compatibilityRelationships,
    ]
  }

  if (
    metadata.dependencyReferences !== undefined
    && relationshipContractVersion !== KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION
  ) {
    fail('Executable relationships require SS002_RELATIONSHIP_V1.', {
      relationshipContractVersion,
    })
  }

  const normalizedRelationships = normalizeKnowledgePackRelationships(dependencyReferences)
  const inertMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !EXECUTABLE_TOP_LEVEL_KEYS.has(key)),
  )
  return {
    relationshipContractVersion: normalizedRelationships.length > 0
      ? KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION
      : '',
    knowledgeAssetId,
    dependencyReferences: normalizedRelationships,
    relationshipChecksum: buildKnowledgePackRelationshipChecksum(normalizedRelationships),
    inertMetadata,
  }
}

export const assertCanonicalRelationshipSourcesEqual = ({ request, source } = {}) => {
  const requestAssetId = normalizeKnowledgeAssetId(request?.knowledgeAssetId)
  const sourceAssetId = normalizeKnowledgeAssetId(source?.knowledgeAssetId)
  if (requestAssetId && sourceAssetId && requestAssetId !== sourceAssetId) {
    fail('Request and source knowledgeAssetId values conflict.', {
      requestAssetId,
      sourceAssetId,
    })
  }
  const requestProvided = request?.dependencyReferences !== undefined
  const sourceProvided = source?.dependencyReferences !== undefined
  const requestRelationships = requestProvided
    ? normalizeKnowledgePackRelationships(request.dependencyReferences)
    : null
  const sourceRelationships = sourceProvided
    ? normalizeKnowledgePackRelationships(source.dependencyReferences)
    : null
  if (
    requestRelationships
    && sourceRelationships
    && stableStringify(requestRelationships) !== stableStringify(sourceRelationships)
  ) {
    fail('Request and source executable relationship metadata conflict.', {
      requestChecksum: buildKnowledgePackRelationshipChecksum(requestRelationships),
      sourceChecksum: buildKnowledgePackRelationshipChecksum(sourceRelationships),
    })
  }
  const relationships = requestRelationships || sourceRelationships || []
  return {
    relationshipContractVersion: relationships.length > 0
      ? KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION
      : '',
    knowledgeAssetId: requestAssetId || sourceAssetId,
    dependencyReferences: relationships,
    relationshipChecksum: buildKnowledgePackRelationshipChecksum(relationships),
  }
}
