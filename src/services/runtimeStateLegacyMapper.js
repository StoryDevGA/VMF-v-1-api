import mongoose from 'mongoose'

import RuntimeEvidenceObject from '../models/RuntimeEvidenceObject.js'
import RuntimeEvidenceSource from '../models/RuntimeEvidenceSource.js'
import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import {
  RUNTIME_STATE_VERSION_PATTERN,
  SHA256_PATTERN,
} from '../models/runtimeStateSchemas.js'
import {
  RUNTIME_STATE_V2_CANONICAL_ALGORITHM,
  RUNTIME_STATE_V2_CANONICAL_ERROR_CODES,
  createRuntimeStateCanonicalMappingManifest,
} from './runtimeStateCanonicalSerializer.js'
import { normalizeRuntimeSectionObject } from './runtimeSectionModelService.js'

export const RUNTIME_STATE_V2_MAPPING_ERROR_CODES = Object.freeze({
  INPUT_INVALID: 'SS014_V2_MAPPING_INPUT_INVALID',
  SCHEMA_INVALID: 'SS014_V2_MAPPING_SCHEMA_INVALID',
})

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const isPlainRecord = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))

const fail = (code, reason) => {
  const error = new Error(reason)
  error.code = code
  error.details = { reason }
  throw error
}

const inputFailure = (reason) => fail(RUNTIME_STATE_V2_MAPPING_ERROR_CODES.INPUT_INVALID, reason)

const serializerFailureReason = (code) => ({
  [RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.REDACTION_FAILED]: 'Legacy source failed canonical admission.',
  [RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.CAP_EXCEEDED]: 'Legacy source exceeded canonical caps.',
  [RUNTIME_STATE_V2_CANONICAL_ERROR_CODES.MAPPING_REQUIRED]: 'Legacy source mapping is incomplete or ambiguous.',
}[code])

const exactKeys = (value, expected) => isPlainRecord(value)
  && Object.keys(value).length === expected.length
  && expected.every((key) => hasOwn(value, key))

const normalizeString = (value, { required = false, casing = 'preserve' } = {}) => {
  if (typeof value !== 'string') return null
  let normalized = value.trim()
  if (casing === 'lower') normalized = normalized.toLowerCase()
  if (casing === 'upper') normalized = normalized.toUpperCase()
  if (required && normalized.length === 0) return null
  return normalized
}

const normalizeObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString()
  if (typeof value === 'string' && /^[0-9a-f]{24}$/.test(value)) return value
  return null
}

const normalizeHash = (value, { optional = true } = {}) => {
  if (value === undefined && optional) return undefined
  const normalized = normalizeString(value, { casing: 'lower' })
  if (normalized === null || (normalized !== '' && !SHA256_PATTERN.test(normalized))) return null
  return normalized
}

const normalizeScore = (value) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null
)

const clonePlain = (value) => {
  if (Array.isArray(value)) return value.map(clonePlain)
  if (isPlainRecord(value)) {
    return Object.keys(value).reduce((result, key) => {
      result[key] = clonePlain(value[key])
      return result
    }, {})
  }
  return value
}

const firstOwn = (record, aliases) => aliases.find((key) => hasOwn(record, key))

const ownString = (record, aliases, { defaultValue = undefined, casing = 'preserve', required = false } = {}) => {
  const key = firstOwn(record, aliases)
  if (!key) return defaultValue
  const normalized = normalizeString(record[key], { required, casing })
  if (normalized === null) return null
  return normalized
}

const commonRow = ({ scope, stateVersion, migrationReceiptId, migrationTimestamp, sourceHash }) => ({
  runtimeInstanceId: scope.runtimeInstanceId,
  runtimeInstanceKey: scope.runtimeInstanceKey,
  customerId: scope.customerId,
  tenantId: scope.tenantId,
  stateVersion,
  sourceStateVersion: stateVersion,
  sourceHash,
  migrationReceiptId,
  current: false,
  createdAt: migrationTimestamp,
  updatedAt: migrationTimestamp,
})

const sanitizeSchemaPath = (value) => String(value || 'document')
  .replace(/[^A-Za-z0-9.[\]]/g, '')
  .slice(0, 80) || 'document'

const validateDto = (Model, dto, family) => {
  try {
    const document = new Model(dto)
    const error = document.validateSync()
    if (!error) return
    const path = Object.keys(error.errors || {}).sort()[0] || error.path || 'document'
    fail(
      RUNTIME_STATE_V2_MAPPING_ERROR_CODES.SCHEMA_INVALID,
      `V2 ${family} row failed schema validation at ${sanitizeSchemaPath(path)}.`,
    )
  } catch (error) {
    if (error?.code === RUNTIME_STATE_V2_MAPPING_ERROR_CODES.SCHEMA_INVALID) throw error
    fail(
      RUNTIME_STATE_V2_MAPPING_ERROR_CODES.SCHEMA_INVALID,
      `V2 ${family} row failed schema validation at ${sanitizeSchemaPath(error?.path)}.`,
    )
  }
}

const normalizeInput = (input) => {
  if (!exactKeys(input, ['legacyInput', 'scope', 'stateVersion', 'migrationReceiptId', 'migrationTimestamp'])) {
    inputFailure('Mapper envelope is invalid.')
  }
  if (!exactKeys(input.scope, ['runtimeInstanceId', 'runtimeInstanceKey', 'customerId', 'tenantId'])) {
    inputFailure('Mapper scope is invalid.')
  }
  const scope = {
    runtimeInstanceId: normalizeObjectId(input.scope.runtimeInstanceId),
    runtimeInstanceKey: normalizeString(input.scope.runtimeInstanceKey, { required: true, casing: 'lower' }),
    customerId: normalizeObjectId(input.scope.customerId),
    tenantId: normalizeObjectId(input.scope.tenantId),
  }
  if (Object.values(scope).some((value) => value === null) || scope.runtimeInstanceKey.length > 160) {
    inputFailure('Mapper scope is invalid.')
  }
  const stateVersion = normalizeString(input.stateVersion, { required: true, casing: 'lower' })
  if (!stateVersion || !RUNTIME_STATE_VERSION_PATTERN.test(stateVersion)) {
    inputFailure('Mapper state version is invalid.')
  }
  const migrationReceiptId = normalizeObjectId(input.migrationReceiptId)
  if (!migrationReceiptId) inputFailure('Mapper receipt identity is invalid.')
  if (typeof input.migrationTimestamp !== 'string') inputFailure('Mapper timestamp is invalid.')
  const parsedTimestamp = new Date(input.migrationTimestamp)
  if (Number.isNaN(parsedTimestamp.valueOf()) || parsedTimestamp.toISOString() !== input.migrationTimestamp) {
    inputFailure('Mapper timestamp is invalid.')
  }
  return { scope, stateVersion, migrationReceiptId, migrationTimestamp: input.migrationTimestamp }
}

const mapSections = ({ manifest, common }) => {
  const normalizedKeys = new Set()
  return manifest.map(({ sectionKey: rawSectionKey, value }) => {
    const sectionKey = normalizeString(rawSectionKey, { required: true, casing: 'lower' })
    if (!sectionKey || normalizedKeys.has(sectionKey) || !isPlainRecord(value)) {
      inputFailure('Section mapping is invalid.')
    }
    normalizedKeys.add(sectionKey)
    let selected
    let stateStatus = 'LEGACY_IMPORTED'
    if (hasOwn(value, 'accepted') && value.accepted !== null) {
      if (!isPlainRecord(value.accepted)) inputFailure('Section mapping is invalid.')
      selected = value.accepted
      stateStatus = 'ACCEPTED'
    } else if (hasOwn(value, 'generated') && value.generated !== null) {
      if (!isPlainRecord(value.generated)) inputFailure('Section mapping is invalid.')
      selected = value.generated
      stateStatus = 'GENERATED'
    }
    const projection = selected || {}
    const summary = ownString(projection, ['summary'], { defaultValue: '' })
    const truthStatus = ownString(projection, ['truthStatus', 'status'], { defaultValue: '', casing: 'upper' })
    const truthHashKey = firstOwn(projection, ['truthHash'])
    const contentHashKey = firstOwn(projection, ['contentHash'])
    const truthHash = truthHashKey ? normalizeHash(projection[truthHashKey], { optional: false }) : ''
    const contentHash = contentHashKey ? normalizeHash(projection[contentHashKey], { optional: false }) : ''
    let evidenceRefs = []
    if (hasOwn(projection, 'evidenceRefs')) {
      if (!Array.isArray(projection.evidenceRefs)
        || Object.keys(projection.evidenceRefs).length !== projection.evidenceRefs.length
        || !projection.evidenceRefs.every((item) => typeof item === 'string')) {
        inputFailure('Section mapping is invalid.')
      }
      evidenceRefs = projection.evidenceRefs.map((item) => item.trim())
    }
    if ([summary, truthStatus, truthHash, contentHash].includes(null)) inputFailure('Section mapping is invalid.')
    const legacyPath = `framework_state.sections.${sectionKey}`
    const sectionDetail = clonePlain(normalizeRuntimeSectionObject({
      value,
      sectionKey,
      runtimePath: legacyPath,
      initializedAt: common.updatedAt,
    }))
    const row = {
      ...common,
      sectionKey,
      legacyPath,
      stateStatus,
      truthStatus,
      truthHash,
      contentHash,
      summary,
      evidenceRefs,
      sectionDetail,
      projectionReceipt: {
        algorithm: RUNTIME_STATE_V2_CANONICAL_ALGORITHM,
        logicalPath: legacyPath,
        sourceHash: common.sourceHash,
        stateVersion: common.stateVersion,
        mappingVersion: 'ss014-v2-mapping-v1',
      },
    }
    validateDto(RuntimeStateSection, row, 'section')
    return row
  })
}

const assertUnique = (values, reason) => {
  if (new Set(values).size !== values.length) inputFailure(reason)
}

const mapSources = ({ manifest, common }) => {
  const rows = manifest.map(({ sourceId: rawSourceId, value }) => {
    if (!isPlainRecord(value)) inputFailure('Source mapping is invalid.')
    const sourceId = normalizeString(rawSourceId, { required: true })
    const sourceType = ownString(value, ['sourceType'], { required: true, casing: 'upper' })
    const title = ownString(value, ['title', 'label'], { defaultValue: '' })
    const sourceRef = ownString(value, ['sourceRef', 'url', 'fileRef'], { defaultValue: '' })
    const hashKey = firstOwn(value, ['contentHash', 'sourceHash'])
    const contentHash = hashKey ? normalizeHash(value[hashKey]) : undefined
    const acquisitionStatus = ownString(value, ['acquisitionStatus'], { casing: 'upper' })
    const acquisitionProfile = ownString(value, ['acquisitionProfile'])
    const lineageRef = ownString(value, ['lineageRef', 'lineage'])
    const reviewStatus = ownString(value, ['reviewStatus'], { casing: 'upper' })
    if ([sourceId, sourceType, title, sourceRef, contentHash, acquisitionStatus,
      acquisitionProfile, lineageRef, reviewStatus].includes(null)) inputFailure('Source mapping is invalid.')
    const row = {
      ...common,
      sourceId,
      sourceType,
      title,
      sourceRef,
      contentHash,
      acquisitionStatus,
      acquisitionProfile,
      lineageRef,
      reviewStatus,
    }
    validateDto(RuntimeEvidenceSource, row, 'source')
    return row
  })
  assertUnique(rows.map(({ sourceId }) => sourceId), 'Source mapping is invalid.')
  return rows
}

const normalizeConfidence = (value) => {
  if (typeof value === 'number') {
    const score = normalizeScore(value)
    return score === null ? null : { level: 'LEGACY_SCORE_ONLY', score, basis: [] }
  }
  if (!isPlainRecord(value)) return null
  const keys = Object.keys(value)
  if (!keys.every((key) => ['level', 'score', 'basis'].includes(key))
    || !hasOwn(value, 'level') || !hasOwn(value, 'score')) return null
  const level = normalizeString(value.level, { required: true, casing: 'upper' })
  const unitScore = normalizeScore(value.score)
  const score = unitScore === null
    && typeof value.score === 'number'
    && Number.isFinite(value.score)
    && value.score > 1
    && value.score <= 100
    ? value.score / 100
    : unitScore
  const basis = hasOwn(value, 'basis') ? value.basis : []
  if (!level || score === null || !Array.isArray(basis)
    || Object.keys(basis).length !== basis.length
    || !basis.every((item) => typeof item === 'string')) return null
  return { level, score, basis: basis.map((item) => item.trim()) }
}

const mapEvidence = ({ manifest, common, sourceIds }) => {
  const rows = manifest.map(({ evidenceObjectId: rawEvidenceObjectId, sourceId: rawSourceId, value }) => {
    if (!isPlainRecord(value)) inputFailure('Evidence mapping is invalid.')
    const evidenceObjectId = normalizeString(rawEvidenceObjectId, { required: true })
    const sourceId = normalizeString(rawSourceId, { required: true })
    if (!sourceIds.has(sourceId)) inputFailure('Evidence mapping is invalid.')
    const sourceType = ownString(value, ['sourceType'], { casing: 'upper' })
    const lineageRef = ownString(value, ['lineageRef', 'lineage'])
    const extractedFact = ownString(value, ['extractedFact', 'fact'], { defaultValue: '' })
    const reviewStatus = ownString(value, ['reviewStatus'], { defaultValue: '', casing: 'upper' })
    const acceptanceState = ownString(value, ['acceptanceState'], { defaultValue: '', casing: 'upper' })
    const validationStatus = ownString(value, ['validationStatus'], { casing: 'upper' })
    const confidence = hasOwn(value, 'confidence') ? normalizeConfidence(value.confidence) : undefined
    let materiality = ownString(value, ['materiality'], { casing: 'upper' })
    let materialityScore = hasOwn(value, 'materialityScore') ? normalizeScore(value.materialityScore) : undefined
    if (hasOwn(value, 'materiality') && typeof value.materiality === 'number') {
      const numeric = normalizeScore(value.materiality)
      if (numeric === null || (materialityScore !== undefined && materialityScore !== numeric)) {
        inputFailure('Evidence mapping is invalid.')
      }
      materiality = 'LEGACY_SCORE_ONLY'
      materialityScore = numeric
    } else if (hasOwn(value, 'materiality') && materiality === null) {
      inputFailure('Evidence mapping is invalid.')
    } else if (!hasOwn(value, 'materiality') && materialityScore !== undefined) {
      if (materialityScore === null) inputFailure('Evidence mapping is invalid.')
      materiality = 'LEGACY_SCORE_ONLY'
    }
    const title = ownString(value, ['title'], { defaultValue: '' })
    const summary = ownString(value, ['summary'], { defaultValue: '' })
    const contentHash = hasOwn(value, 'contentHash') ? normalizeHash(value.contentHash) : undefined
    const truthHash = hasOwn(value, 'truthHash') ? normalizeHash(value.truthHash) : undefined
    const lineageHash = hasOwn(value, 'lineageHash') ? normalizeHash(value.lineageHash) : undefined
    if ([evidenceObjectId, sourceId, sourceType, lineageRef, extractedFact,
      reviewStatus, acceptanceState, validationStatus, confidence, materiality,
      materialityScore, title, summary, contentHash, truthHash, lineageHash].includes(null)) {
      inputFailure('Evidence mapping is invalid.')
    }
    const row = {
      ...common,
      evidenceObjectId,
      sourceId,
      sourceType,
      lineageRef,
      extractedFact,
      reviewStatus,
      acceptanceState,
      validationStatus,
      confidence,
      materiality,
      materialityScore,
      title,
      summary,
      contentHash,
      truthHash,
      lineageHash,
    }
    validateDto(RuntimeEvidenceObject, row, 'evidence')
    return row
  })
  assertUnique(rows.map(({ evidenceObjectId }) => evidenceObjectId), 'Evidence mapping is invalid.')
  return rows
}

const SNAPSHOT_METADATA_KEYS = new Set([
  'artifactType', 'build', 'coverage', 'dependencies', 'frameworkId',
  'frameworkKey', 'health', 'packageKey', 'packageVersion', 'registries',
  'runtimeType', 'scope', 'validation', 'warnings',
])
const COUNT_KEYS = new Set(['counts', 'nodeCount', 'edgeCount'])
const GRAPH_IDENTITY_KEYS = new Set([
  'runtimeInstanceId', 'runtimeInstanceKey', 'runtimeId', 'customerId',
  'tenantId', 'projectId', 'outcomeId',
])
const GRAPH_CONSUMED_KEYS = new Set([
  'graphVersion', 'graphHash', 'nodes', 'edges', ...COUNT_KEYS, ...GRAPH_IDENTITY_KEYS,
])
const GRAPH_SCOPE_KEYS = new Set([
  'customerId', 'tenantId', 'projectId', 'outcomeId', 'frameworkId', 'runtimeId',
])
const GRAPH_SCOPE_PROJECTED_KEYS = ['frameworkId', 'runtimeId']
const NODE_ID_KEYS = new Set(['nodeId', 'id', '_id', 'key'])
const EDGE_ID_KEYS = new Set(['edgeId', 'id', '_id', 'key'])
const ENDPOINT_KEYS = new Set(['fromNodeId', 'toNodeId', 'from', 'to'])
const NODE_ATTRIBUTE_KEYS = new Set([
  'consumerType', 'coverageDomain', 'customerVisible', 'entityDefinitionKey',
  'entityDisplayName', 'evidenceObjectId', 'frameworkKey', 'graphQualityState',
  'lockVersion', 'lockedAt', 'lockedBy', 'metadata', 'nodeType', 'packageKey',
  'packageVersion', 'publishVersion', 'publishedAt', 'publishedBy',
  'replayAnchorId', 'required', 'reviewStatus', 'runtimePath', 'scope',
  'sectionKey', 'signalType', 'snapshotHash', 'snippet',
  'sourceEvidenceNodeIds', 'sourceId', 'sourceKind', 'sourceType',
])
const EDGE_ATTRIBUTE_KEYS = new Set([
  'basis', 'builtAt', 'confidenceDriverRefs', 'contributesTo', 'customerVisible',
  'relationshipDefinitionKey', 'relationshipDisplayName', 'sourceRefs',
  'validationState',
])

const assertCount = (value) => Number.isSafeInteger(value) && value >= 0

const projectGraphScope = (value) => {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !GRAPH_SCOPE_KEYS.has(key))) {
    inputFailure('Snapshot mapping is invalid.')
  }
  return GRAPH_SCOPE_PROJECTED_KEYS.reduce((scope, key) => {
    if (!hasOwn(value, key)) return scope
    const normalized = normalizeString(value[key])
    if (normalized === null) inputFailure('Snapshot mapping is invalid.')
    scope[key] = normalized
    return scope
  }, {})
}

const reconcileCounts = (metadata, nodeCount, edgeCount) => {
  if (hasOwn(metadata, 'counts')) {
    if (!exactKeys(metadata.counts, ['nodeCount', 'edgeCount'])
      || !assertCount(metadata.counts.nodeCount) || !assertCount(metadata.counts.edgeCount)
      || metadata.counts.nodeCount !== nodeCount || metadata.counts.edgeCount !== edgeCount) {
      inputFailure('Snapshot mapping is invalid.')
    }
  }
  for (const [key, expected] of [['nodeCount', nodeCount], ['edgeCount', edgeCount]]) {
    if (hasOwn(metadata, key) && (!assertCount(metadata[key]) || metadata[key] !== expected)) {
      inputFailure('Snapshot mapping is invalid.')
    }
  }
}

const copyAttributes = (value, consumed, allowed, familyReason) => {
  const attributes = {}
  for (const key of Object.keys(value)) {
    if (consumed.has(key)) continue
    if (!allowed.has(key)) inputFailure(familyReason)
    attributes[key] = clonePlain(value[key])
  }
  return attributes
}

const normalizeNodeAttributes = (value, consumed) => {
  const attributes = copyAttributes(value, consumed, NODE_ATTRIBUTE_KEYS, 'Node mapping is invalid.')
  if (!hasOwn(attributes, 'scope') || isPlainRecord(attributes.scope)) return attributes
  const scope = normalizeString(attributes.scope, { required: true, casing: 'upper' })
  if (!['GLOBAL', 'SECTION'].includes(scope)) inputFailure('Node mapping is invalid.')
  attributes.scope = scope
  return attributes
}

const mapGraph = ({ graph, common }) => {
  const graphVersion = normalizeString(graph.graphVersion, { required: true })
  const snapshotId = normalizeString(graph.snapshotId, { required: true })
  if (!graphVersion || !snapshotId || !isPlainRecord(graph.metadata)) inputFailure('Snapshot mapping is invalid.')
  const nodeCount = graph.nodes.length
  const edgeCount = graph.edges.length
  reconcileCounts(graph.metadata, nodeCount, edgeCount)
  const graphHash = hasOwn(graph.metadata, 'graphHash')
    ? normalizeHash(graph.metadata.graphHash, { optional: false })
    : ''
  if (graphHash === null || (hasOwn(graph.metadata, 'graphHash') && graphHash === '')) {
    inputFailure('Snapshot mapping is invalid.')
  }
  const metadata = {}
  for (const key of Object.keys(graph.metadata)) {
    if (GRAPH_CONSUMED_KEYS.has(key)) continue
    if (!SNAPSHOT_METADATA_KEYS.has(key)) inputFailure('Snapshot mapping is invalid.')
    metadata[key] = key === 'scope'
      ? projectGraphScope(graph.metadata[key])
      : clonePlain(graph.metadata[key])
  }
  const snapshot = {
    ...common,
    snapshotId,
    graphVersion,
    graphHash,
    stateStatus: 'STALE',
    counts: { nodeCount, edgeCount },
    metadata,
  }
  validateDto(RuntimeGraphSnapshot, snapshot, 'snapshot')

  const nodeRows = graph.nodes.map(({ elementKey: rawElementKey, value }) => {
    if (!isPlainRecord(value)) inputFailure('Node mapping is invalid.')
    const elementKey = normalizeString(rawElementKey, { required: true })
    const label = ownString(value, ['label'], { defaultValue: '' })
    const summary = ownString(value, ['summary'], { defaultValue: '' })
    if (!elementKey || label === null || summary === null) inputFailure('Node mapping is invalid.')
    const consumed = new Set([...NODE_ID_KEYS, 'label', 'summary', 'snapshotId'])
    const row = {
      ...common,
      snapshotId,
      graphVersion,
      elementType: 'NODE',
      elementKey,
      fromElementKey: '',
      toElementKey: '',
      relationshipType: '',
      label,
      summary,
      attributes: normalizeNodeAttributes(value, consumed),
    }
    validateDto(RuntimeGraphElement, row, 'node')
    return row
  })
  assertUnique(nodeRows.map(({ elementKey }) => elementKey), 'Node mapping is invalid.')
  const nodeKeys = new Set(nodeRows.map(({ elementKey }) => elementKey))

  const edgeRows = graph.edges.map(({
    elementKey: rawElementKey,
    fromElementKey: rawFrom,
    toElementKey: rawTo,
    value,
  }) => {
    if (!isPlainRecord(value)) inputFailure('Edge mapping is invalid.')
    const elementKey = normalizeString(rawElementKey, { required: true })
    const fromElementKey = normalizeString(rawFrom, { required: true })
    const toElementKey = normalizeString(rawTo, { required: true })
    const relationshipType = ownString(value, ['edgeType', 'relationshipType', 'relation'], { defaultValue: '', casing: 'upper' })
    const label = ownString(value, ['label'], { defaultValue: '' })
    const summary = ownString(value, ['summary'], { defaultValue: '' })
    if (!elementKey || !fromElementKey || !toElementKey
      || relationshipType === null || label === null || summary === null
      || !nodeKeys.has(fromElementKey) || !nodeKeys.has(toElementKey)) {
      inputFailure('Edge mapping is invalid.')
    }
    const consumed = new Set([
      ...EDGE_ID_KEYS, ...ENDPOINT_KEYS, 'edgeType', 'relationshipType', 'relation', 'label', 'summary',
    ])
    const row = {
      ...common,
      snapshotId,
      graphVersion,
      elementType: 'EDGE',
      elementKey,
      fromElementKey,
      toElementKey,
      relationshipType,
      label,
      summary,
      attributes: copyAttributes(value, consumed, EDGE_ATTRIBUTE_KEYS, 'Edge mapping is invalid.'),
    }
    validateDto(RuntimeGraphElement, row, 'edge')
    return row
  })
  assertUnique(edgeRows.map(({ elementKey }) => elementKey), 'Edge mapping is invalid.')
  const elementKeys = [...nodeRows, ...edgeRows].map(({ elementKey }) => elementKey)
  assertUnique(elementKeys, 'Edge mapping is invalid.')
  return { snapshot, nodeRows, edgeRows }
}

const createMappingContext = (input) => {
  let authority
  try {
    authority = normalizeInput(input)
  } catch (error) {
    if (Object.values(RUNTIME_STATE_V2_MAPPING_ERROR_CODES).includes(error?.code)) throw error
    inputFailure('Mapper envelope is invalid.')
  }
  let canonical
  try {
    canonical = createRuntimeStateCanonicalMappingManifest(input.legacyInput)
  } catch (error) {
    const reason = serializerFailureReason(error?.code)
    if (reason) fail(error.code, reason)
    inputFailure('Mapper envelope is invalid.')
  }
  const { serializerResult, mappingManifest } = canonical
  return { authority, serializerResult, mappingManifest }
}

const createSourceRows = ({ authority, serializerResult, mappingManifest }) => {
  const sectionCommon = commonRow({
    ...authority,
    sourceHash: serializerResult.domains.sections.sourceHash,
  })
  const evidenceCommon = commonRow({
    ...authority,
    sourceHash: serializerResult.domains.evidencePack.sourceHash,
  })
  const graphCommon = commonRow({
    ...authority,
    sourceHash: serializerResult.domains.intelligenceGraph.sourceHash,
  })
  const sections = mapSections({ manifest: mappingManifest.sections, common: sectionCommon })
  const evidenceSources = mapSources({ manifest: mappingManifest.evidenceSources, common: evidenceCommon })
  const sourceIds = new Set(evidenceSources.map(({ sourceId }) => sourceId))
  const evidenceObjects = mapEvidence({
    manifest: mappingManifest.evidenceObjects,
    common: evidenceCommon,
    sourceIds,
  })
  return { evidenceObjects, evidenceSources, sections }
}

export const createRuntimeStateLegacySourceRowSet = (input) => {
  const context = createMappingContext(input)
  const { authority, serializerResult } = context
  const { evidenceObjects, evidenceSources, sections } = createSourceRows(context)
  return {
    schemaVersion: 'ss014-v2-source-row-set-v1',
    algorithm: serializerResult.algorithm,
    sourceSetHash: serializerResult.sourceSetHash,
    stateVersion: authority.stateVersion,
    counts: {
      sectionCount: sections.length,
      sourceCount: evidenceSources.length,
      evidenceObjectCount: evidenceObjects.length,
    },
    rows: { sections, evidenceSources, evidenceObjects },
  }
}

export const createRuntimeStateLegacyRowSet = (input) => {
  const context = createMappingContext(input)
  const { authority, serializerResult, mappingManifest } = context
  const { evidenceObjects, evidenceSources, sections } = createSourceRows(context)
  const graphCommon = commonRow({
    ...authority,
    sourceHash: serializerResult.domains.intelligenceGraph.sourceHash,
  })
  const { snapshot, nodeRows, edgeRows } = mapGraph({ graph: mappingManifest.graph, common: graphCommon })
  return {
    schemaVersion: 'ss014-v2-row-set-v1',
    algorithm: serializerResult.algorithm,
    sourceSetHash: serializerResult.sourceSetHash,
    stateVersion: authority.stateVersion,
    counts: {
      sectionCount: sections.length,
      sourceCount: evidenceSources.length,
      evidenceObjectCount: evidenceObjects.length,
      graphSnapshotCount: 1,
      graphNodeCount: nodeRows.length,
      graphEdgeCount: edgeRows.length,
    },
    rows: {
      sections,
      evidenceSources,
      evidenceObjects,
      graphSnapshots: [snapshot],
      graphElements: [...nodeRows, ...edgeRows],
    },
  }
}
