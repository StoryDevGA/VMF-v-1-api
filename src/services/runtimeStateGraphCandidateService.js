import mongoose from 'mongoose'

import RuntimeGraphElement from '../models/RuntimeGraphElement.js'
import RuntimeGraphSnapshot from '../models/RuntimeGraphSnapshot.js'
import {
  RUNTIME_STATE_VERSION_PATTERN,
  SHA256_PATTERN,
} from '../models/runtimeStateSchemas.js'
import {
  RUNTIME_INTELLIGENCE_GRAPH_ARTIFACT_TYPE,
  RUNTIME_INTELLIGENCE_GRAPH_VERSION,
  hashRuntimeIntelligenceGraphValue,
  validateRuntimeIntelligenceGraph,
} from './runtimeIntelligenceGraphService.js'
import { serializeRuntimeStateIntelligenceGraphDomain } from './runtimeStateCanonicalSerializer.js'

export const RUNTIME_STATE_V2_GRAPH_CANDIDATE_ERROR_CODES = Object.freeze({
  INPUT_INVALID: 'RUNTIME_STATE_V2_GRAPH_CANDIDATE_INVALID',
  SCHEMA_INVALID: 'RUNTIME_STATE_V2_GRAPH_CANDIDATE_SCHEMA_INVALID',
})

const TOP_LEVEL_KEYS = new Set([
  'artifactType', 'graphVersion', 'runtimeInstanceId', 'runtimeId', 'customerId',
  'tenantId', 'projectId', 'outcomeId', 'frameworkId', 'scope',
  'runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageKey',
  'packageVersion', 'build', 'nodes', 'edges', 'registries', 'coverage',
  'dependencies', 'health', 'warnings', 'validation', 'graphHash',
])
const SCOPE_KEYS = new Set([
  'customerId', 'tenantId', 'projectId', 'outcomeId', 'frameworkId', 'runtimeId',
])
const BUILD_KEYS = new Set([
  'status', 'trigger', 'builtAt', 'builtBy', 'sourceHash', 'nodeCount', 'edgeCount',
])
const SNAPSHOT_METADATA_KEYS = new Set([
  'artifactType', 'build', 'coverage', 'dependencies', 'frameworkId',
  'frameworkKey', 'health', 'packageKey', 'packageVersion', 'registries',
  'runtimeType', 'scope', 'validation', 'warnings',
])
const NODE_CONSUMED_KEYS = new Set(['nodeId', 'label', 'summary'])
const NODE_ATTRIBUTE_KEYS = new Set([
  'consumerType', 'coverageDomain', 'customerVisible', 'entityDefinitionKey',
  'entityDisplayName', 'evidenceObjectId', 'frameworkKey', 'graphQualityState',
  'lockVersion', 'lockedAt', 'lockedBy', 'metadata', 'nodeType', 'packageKey',
  'packageVersion', 'publishVersion', 'publishedAt', 'publishedBy',
  'replayAnchorId', 'required', 'reviewStatus', 'runtimePath', 'scope',
  'sectionKey', 'signalType', 'snapshotHash', 'snapshotId', 'snippet',
  'sourceEvidenceNodeIds', 'sourceId', 'sourceKind', 'sourceType',
])
const EDGE_CONSUMED_KEYS = new Set([
  'edgeId', 'fromNodeId', 'toNodeId', 'edgeType', 'label', 'summary',
])
const EDGE_ATTRIBUTE_KEYS = new Set([
  'basis', 'builtAt', 'confidenceDriverRefs', 'contributesTo',
  'customerVisible', 'relationshipDefinitionKey', 'relationshipDisplayName',
  'sourceRefs', 'validationState',
])

const isPlainRecord = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))

const isCanonicalOptionalIdentity = (value) => value === null
  || (typeof value === 'string' && value.length > 0 && value === value.trim())

const fail = (code, message) => {
  const error = new Error(message)
  error.code = code
  error.details = { reason: message }
  throw error
}

const inputFailure = (message) => fail(
  RUNTIME_STATE_V2_GRAPH_CANDIDATE_ERROR_CODES.INPUT_INVALID,
  message,
)

const clonePlain = (value) => {
  if (Array.isArray(value)) return value.map(clonePlain)
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clonePlain(child)]))
  }
  return value
}

const assertExactKeys = (value, allowed, message) => {
  if (!isPlainRecord(value)) inputFailure(message)
  const keys = Object.keys(value)
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) inputFailure(message)
}

const copyAllowed = ({ value, consumed, allowed, message }) => {
  if (!isPlainRecord(value)) inputFailure(message)
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (consumed.has(key)) continue
    if (!allowed.has(key)) inputFailure(message)
    result[key] = clonePlain(child)
  }
  return result
}

const validateDto = (Model, dto, family) => {
  try {
    const document = new Model(dto)
    const validationError = document.validateSync()
    if (!validationError) {
      const validated = document.toObject({ depopulate: true, versionKey: false })
      delete validated._id
      return validated
    }
    const path = Object.keys(validationError.errors || {}).sort()[0] || 'document'
    fail(
      RUNTIME_STATE_V2_GRAPH_CANDIDATE_ERROR_CODES.SCHEMA_INVALID,
      `V2 graph ${family} candidate failed schema validation at ${path}.`,
    )
  } catch (error) {
    if (error?.code === RUNTIME_STATE_V2_GRAPH_CANDIDATE_ERROR_CODES.SCHEMA_INVALID) throw error
    fail(
      RUNTIME_STATE_V2_GRAPH_CANDIDATE_ERROR_CODES.SCHEMA_INVALID,
      `V2 graph ${family} candidate failed schema validation.`,
    )
  }
}

const normalizeAuthority = ({ scope, stateVersion, migrationReceiptId }) => {
  const authorityKeys = new Set([
    'runtimeInstanceId', 'runtimeInstanceKey', 'customerId', 'tenantId',
  ])
  assertExactKeys(scope, authorityKeys, 'V2 graph candidate scope is invalid.')
  const hasCanonicalObjectId = (value) => typeof value === 'string'
    && /^[0-9a-f]{24}$/.test(value)
    && mongoose.isValidObjectId(value)
  if (!hasCanonicalObjectId(scope.runtimeInstanceId)
    || !hasCanonicalObjectId(scope.customerId)
    || !hasCanonicalObjectId(scope.tenantId)
    || !hasCanonicalObjectId(migrationReceiptId)
    || typeof scope.runtimeInstanceKey !== 'string'
    || !scope.runtimeInstanceKey
    || scope.runtimeInstanceKey !== scope.runtimeInstanceKey.trim().toLowerCase()
    || typeof stateVersion !== 'string'
    || !RUNTIME_STATE_VERSION_PATTERN.test(stateVersion)) {
    inputFailure('V2 graph candidate authority is invalid.')
  }
  return {
    runtimeInstanceId: scope.runtimeInstanceId,
    runtimeInstanceKey: scope.runtimeInstanceKey,
    customerId: scope.customerId,
    tenantId: scope.tenantId,
    stateVersion,
    migrationReceiptId,
  }
}

const assertGraphIdentity = ({ graph, authority }) => {
  assertExactKeys(graph, TOP_LEVEL_KEYS, 'Logical graph envelope is invalid.')
  assertExactKeys(graph.scope, SCOPE_KEYS, 'Logical graph scope is invalid.')
  if (graph.runtimeInstanceId !== authority.runtimeInstanceId
    || graph.runtimeId !== authority.runtimeInstanceId
    || graph.customerId !== authority.customerId
    || graph.tenantId !== authority.tenantId
    || graph.runtimeInstanceKey !== authority.runtimeInstanceKey
    || graph.scope.runtimeId !== authority.runtimeInstanceId
    || graph.scope.customerId !== authority.customerId
    || graph.scope.tenantId !== authority.tenantId
    || graph.frameworkId !== graph.scope.frameworkId
    || graph.projectId !== graph.scope.projectId
    || graph.outcomeId !== graph.scope.outcomeId) {
    inputFailure('Logical graph identity is contradictory.')
  }
}

const assertGraphIntegrity = (graph) => {
  assertExactKeys(graph.build, BUILD_KEYS, 'Logical graph build evidence is invalid.')
  if (graph.artifactType !== RUNTIME_INTELLIGENCE_GRAPH_ARTIFACT_TYPE
    || graph.graphVersion !== RUNTIME_INTELLIGENCE_GRAPH_VERSION
    || typeof graph.runtimeInstanceId !== 'string'
    || typeof graph.runtimeId !== 'string'
    || typeof graph.customerId !== 'string'
    || typeof graph.tenantId !== 'string'
    || typeof graph.runtimeInstanceKey !== 'string'
    || typeof graph.frameworkId !== 'string'
    || !graph.frameworkId
    || !isCanonicalOptionalIdentity(graph.projectId)
    || !isCanonicalOptionalIdentity(graph.outcomeId)
    || graph.build.status !== 'VALID'
    || typeof graph.build.trigger !== 'string'
    || typeof graph.build.builtAt !== 'string'
    || typeof graph.build.builtBy !== 'string'
    || !isPlainRecord(graph.validation)
    || graph.validation.status !== 'VALID'
    || !Array.isArray(graph.validation.issues)
    || graph.validation.issues.length !== 0
    || !Array.isArray(graph.nodes)
    || !Array.isArray(graph.edges)
    || !Number.isSafeInteger(graph.build.nodeCount)
    || !Number.isSafeInteger(graph.build.edgeCount)
    || graph.build.nodeCount !== graph.nodes.length
    || graph.build.edgeCount !== graph.edges.length
    || typeof graph.build.sourceHash !== 'string'
    || !SHA256_PATTERN.test(graph.build.sourceHash)
    || typeof graph.graphHash !== 'string'
    || !SHA256_PATTERN.test(graph.graphHash)) {
    inputFailure('Logical graph build evidence is invalid.')
  }
  const validationIssues = validateRuntimeIntelligenceGraph(graph)
  if (validationIssues.length > 0) inputFailure('Logical graph validation failed.')
  const expectedGraphHash = hashRuntimeIntelligenceGraphValue({
    artifactType: graph.artifactType,
    graphVersion: graph.graphVersion,
    runtimeInstanceId: graph.runtimeInstanceId,
    scope: graph.scope,
    sourceHash: graph.build.sourceHash,
    nodes: graph.nodes,
    edges: graph.edges,
    registries: graph.registries,
    coverage: graph.coverage,
    dependencies: graph.dependencies,
    health: graph.health,
    validation: graph.validation,
  })
  if (expectedGraphHash !== graph.graphHash) inputFailure('Logical graph hash is invalid.')
}

const mapElements = ({ graph, common, snapshotId }) => {
  const nodeKeys = new Set()
  const nodes = graph.nodes.map((node) => {
    const elementKey = typeof node.nodeId === 'string' ? node.nodeId.trim() : ''
    if (!elementKey || nodeKeys.has(elementKey)) inputFailure('Logical graph node identity is invalid.')
    nodeKeys.add(elementKey)
    const row = {
      ...common,
      snapshotId,
      graphVersion: graph.graphVersion,
      elementType: 'NODE',
      elementKey,
      fromElementKey: '',
      toElementKey: '',
      relationshipType: '',
      label: typeof node.label === 'string' ? node.label.trim() : '',
      summary: typeof node.summary === 'string' ? node.summary.trim() : '',
      attributes: copyAllowed({
        value: node,
        consumed: NODE_CONSUMED_KEYS,
        allowed: NODE_ATTRIBUTE_KEYS,
        message: 'Logical graph node projection is invalid.',
      }),
    }
    return validateDto(RuntimeGraphElement, row, 'node')
  })

  const edgeKeys = new Set()
  const edges = graph.edges.map((edge) => {
    const elementKey = typeof edge.edgeId === 'string' ? edge.edgeId.trim() : ''
    const fromElementKey = typeof edge.fromNodeId === 'string' ? edge.fromNodeId.trim() : ''
    const toElementKey = typeof edge.toNodeId === 'string' ? edge.toNodeId.trim() : ''
    if (!elementKey || edgeKeys.has(elementKey) || nodeKeys.has(elementKey)
      || !nodeKeys.has(fromElementKey) || !nodeKeys.has(toElementKey)) {
      inputFailure('Logical graph edge identity is invalid.')
    }
    edgeKeys.add(elementKey)
    const row = {
      ...common,
      snapshotId,
      graphVersion: graph.graphVersion,
      elementType: 'EDGE',
      elementKey,
      fromElementKey,
      toElementKey,
      relationshipType: typeof edge.edgeType === 'string' ? edge.edgeType.trim().toUpperCase() : '',
      label: typeof edge.label === 'string' ? edge.label.trim() : '',
      summary: typeof edge.summary === 'string' ? edge.summary.trim() : '',
      attributes: copyAllowed({
        value: edge,
        consumed: EDGE_CONSUMED_KEYS,
        allowed: EDGE_ATTRIBUTE_KEYS,
        message: 'Logical graph edge projection is invalid.',
      }),
    }
    return validateDto(RuntimeGraphElement, row, 'edge')
  })
  return { nodes, edges }
}

export const createRuntimeStateGraphCandidate = ({
  graph,
  scope,
  stateVersion,
  migrationReceiptId,
} = {}) => {
  const authority = normalizeAuthority({ scope, stateVersion, migrationReceiptId })
  assertGraphIdentity({ graph, authority })
  assertGraphIntegrity(graph)

  let graphDomain
  try {
    graphDomain = serializeRuntimeStateIntelligenceGraphDomain(graph)
  } catch (_error) {
    inputFailure('Logical graph canonical serialization failed.')
  }
  const sourceHash = graphDomain.sourceHash
  const snapshotId = `rgs:${graph.graphHash.slice('sha256:'.length)}`
  const common = {
    ...authority,
    sourceStateVersion: stateVersion,
    sourceHash,
    current: false,
  }
  const metadata = copyAllowed({
    value: {
      artifactType: graph.artifactType,
      build: graph.build,
      coverage: graph.coverage,
      dependencies: graph.dependencies,
      frameworkId: graph.frameworkId,
      frameworkKey: graph.frameworkKey,
      health: graph.health,
      packageKey: graph.packageKey,
      packageVersion: graph.packageVersion,
      registries: graph.registries,
      runtimeType: graph.runtimeType,
      scope: { runtimeId: graph.scope.runtimeId, frameworkId: graph.scope.frameworkId },
      validation: graph.validation,
      warnings: graph.warnings,
    },
    consumed: new Set(),
    allowed: SNAPSHOT_METADATA_KEYS,
    message: 'Logical graph snapshot projection is invalid.',
  })
  const snapshot = {
    ...common,
    snapshotId,
    graphVersion: graph.graphVersion,
    graphHash: graph.graphHash,
    stateStatus: 'REBUILDING',
    counts: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length },
    metadata,
  }
  const validatedSnapshot = validateDto(RuntimeGraphSnapshot, snapshot, 'snapshot')
  const elements = mapElements({ graph, common, snapshotId })

  return {
    schemaVersion: 'runtime-state-v2-graph-candidate-v1',
    sourceHash,
    stateVersion,
    snapshot: validatedSnapshot,
    nodes: elements.nodes,
    edges: elements.edges,
    counts: {
      nodeCount: elements.nodes.length,
      edgeCount: elements.edges.length,
      elementCount: elements.nodes.length + elements.edges.length,
    },
  }
}
