import { jest } from '@jest/globals'

import {
  hashRuntimeIntelligenceGraphValue,
} from '../services/runtimeIntelligenceGraphService.js'
import {
  RUNTIME_STATE_V2_GRAPH_CANDIDATE_ERROR_CODES,
  createRuntimeStateGraphCandidate,
} from '../services/runtimeStateGraphCandidateService.js'

const ids = {
  runtimeInstanceId: '64b000000000000000000001',
  customerId: '64b000000000000000000002',
  tenantId: '64b000000000000000000003',
  migrationReceiptId: '64b000000000000000000004',
  frameworkId: '64b000000000000000000005',
  projectId: '64b000000000000000000006',
  outcomeId: '64b000000000000000000007',
}
const stateVersion = 'rsv2:12345678-1234-4123-8123-123456789abc'
const builderSourceHash = `sha256:${'a'.repeat(64)}`
const scope = {
  runtimeInstanceId: ids.runtimeInstanceId,
  runtimeInstanceKey: 'runtime-one',
  customerId: ids.customerId,
  tenantId: ids.tenantId,
}

const graphHashFor = (graph) => hashRuntimeIntelligenceGraphValue({
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

const makeGraph = (overrides = {}) => {
  const graph = {
    artifactType: 'runtime_intelligence_graph',
    graphVersion: '2.2',
    runtimeInstanceId: ids.runtimeInstanceId,
    runtimeId: ids.runtimeInstanceId,
    customerId: ids.customerId,
    tenantId: ids.tenantId,
    projectId: ids.projectId,
    outcomeId: ids.outcomeId,
    frameworkId: ids.frameworkId,
    scope: {
      customerId: ids.customerId,
      tenantId: ids.tenantId,
      projectId: ids.projectId,
      outcomeId: ids.outcomeId,
      frameworkId: ids.frameworkId,
      runtimeId: ids.runtimeInstanceId,
    },
    runtimeInstanceKey: 'runtime-one',
    runtimeType: 'VALUE_NARRATIVE',
    frameworkKey: 'VMF',
    packageKey: 'vmf-standard',
    packageVersion: '1.0.0',
    build: {
      status: 'VALID',
      trigger: 'EXPLICIT_REBUILD',
      builtAt: '2026-08-28T18:00:00.000Z',
      builtBy: ids.customerId,
      sourceHash: builderSourceHash,
      nodeCount: 2,
      edgeCount: 1,
    },
    nodes: [
      {
        nodeId: 'source:one',
        nodeType: 'SOURCE',
        label: 'Source',
        summary: 'Source summary',
        sourceId: 'source-1',
        customerVisible: true,
      },
      {
        nodeId: 'evidence:one',
        nodeType: 'EVIDENCE',
        label: 'Evidence',
        summary: 'Evidence summary',
        evidenceObjectId: 'evidence-1',
        snapshotId: 'published-snapshot-1',
        sourceId: 'source-1',
        customerVisible: true,
      },
    ],
    edges: [{
      edgeId: 'source-produces-evidence:one',
      edgeType: 'SOURCE_PRODUCES_EVIDENCE',
      fromNodeId: 'source:one',
      toNodeId: 'evidence:one',
      basis: 'source lineage',
      customerVisible: true,
    }],
    registries: { entityTypes: {}, relationshipTypes: {} },
    coverage: { coveragePercent: 100 },
    dependencies: { sectionDependencyCount: 0 },
    health: { state: 'HEALTHY' },
    warnings: [],
    validation: { status: 'VALID', issues: [] },
    graphHash: '',
    ...overrides,
  }
  graph.graphHash = overrides.graphHash || graphHashFor(graph)
  return graph
}

const buildCandidate = (graph = makeGraph()) => createRuntimeStateGraphCandidate({
  graph,
  scope,
  stateVersion,
  migrationReceiptId: ids.migrationReceiptId,
})

const expectInvalid = (graph) => expect(() => buildCandidate(graph)).toThrow(expect.objectContaining({
  code: RUNTIME_STATE_V2_GRAPH_CANDIDATE_ERROR_CODES.INPUT_INVALID,
}))

describe('Runtime State V2 graph candidate service', () => {
  test('maps one authentic logical graph into validated V2 snapshot and element candidates', () => {
    const graph = makeGraph()
    const before = JSON.stringify(graph)
    const result = buildCandidate(graph)

    expect(JSON.stringify(graph)).toBe(before)
    expect(result).toMatchObject({
      schemaVersion: 'runtime-state-v2-graph-candidate-v1',
      stateVersion,
      counts: { nodeCount: 2, edgeCount: 1, elementCount: 3 },
      snapshot: {
        snapshotId: `rgs:${graph.graphHash.slice('sha256:'.length)}`,
        stateStatus: 'REBUILDING',
        current: false,
        counts: { nodeCount: 2, edgeCount: 1 },
      },
    })
    expect(result.nodes.map((row) => row.elementKey)).toEqual(['source:one', 'evidence:one'])
    expect(result.nodes[1].attributes.snapshotId).toBe('published-snapshot-1')
    expect(result.edges[0]).toMatchObject({
      elementKey: 'source-produces-evidence:one',
      fromElementKey: 'source:one',
      toElementKey: 'evidence:one',
    })
    expect(result.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.sourceHash).not.toBe(builderSourceHash)
    expect(result.snapshot.metadata.build.sourceHash).toBe(builderSourceHash)
    expect(result.snapshot).toHaveProperty('sourceHash', result.sourceHash)
    expect([...result.nodes, ...result.edges].every((row) => row.sourceHash === result.sourceHash)).toBe(true)
    expect(result.snapshot.metadata).not.toHaveProperty('projectId')
    expect(result.snapshot.metadata).not.toHaveProperty('outcomeId')
    expect(typeof result.snapshot.graphVersion).toBe('string')
    expect(result.snapshot.runtimeInstanceId.toHexString()).toBe(ids.runtimeInstanceId)
  })

  test('returns the same snapshot and source identities for an identical retry', () => {
    const first = buildCandidate()
    const second = buildCandidate()
    expect(second.snapshot.snapshotId).toBe(first.snapshot.snapshotId)
    expect(second.sourceHash).toBe(first.sourceHash)
  })

  test.each([
    ['invalid build status', (graph) => { graph.build.status = 'INVALID' }],
    ['invalid validation status', (graph) => { graph.validation.status = 'INVALID' }],
    ['builder validation issue', (graph) => { graph.nodes[0].nodeType = 'UNKNOWN' }],
    ['count disagreement', (graph) => { graph.build.nodeCount = 99 }],
  ])('rejects %s', (_label, mutate) => {
    const graph = makeGraph()
    mutate(graph)
    expectInvalid(graph)
  })

  test.each([
    ['runtime identity disagreement', (graph) => { graph.runtimeId = ids.customerId }],
    ['framework identity disagreement', (graph) => { graph.scope.frameworkId = ids.customerId }],
    ['unknown scope field', (graph) => { graph.scope.extra = true }],
    ['unknown top-level field', (graph) => { graph.extra = true }],
  ])('rejects %s', (_label, mutate) => {
    const graph = makeGraph()
    mutate(graph)
    graph.graphHash = graphHashFor(graph)
    expectInvalid(graph)
  })

  test('rejects changed valid graph content paired with a stale well-formed graph hash', () => {
    const graph = makeGraph()
    graph.nodes[0].label = 'Tampered source label'
    expectInvalid(graph)
  })

  test.each([
    ['non-builder artifact', (graph) => { graph.artifactType = 'not_builder_graph' }],
    ['non-builder version type', (graph) => { graph.graphVersion = 2.2 }],
    ['extra build field', (graph) => { graph.build.extra = true }],
    ['malformed builder source hash', (graph) => { graph.build.sourceHash = 'sha256:bad' }],
    ['malformed graph hash', (graph) => { graph.graphHash = 'sha256:bad' }],
  ])('rejects strict builder-shape drift: %s', (_label, mutate) => {
    const graph = makeGraph()
    mutate(graph)
    if (graph.graphHash !== 'sha256:bad') graph.graphHash = graphHashFor(graph)
    expectInvalid(graph)
  })

  test('rejects non-canonical authority key casing', () => {
    const graph = makeGraph()
    expect(() => createRuntimeStateGraphCandidate({
      graph,
      scope: { ...scope, runtimeInstanceKey: 'RUNTIME-ONE' },
      stateVersion,
      migrationReceiptId: ids.migrationReceiptId,
    })).toThrow(expect.objectContaining({
      code: RUNTIME_STATE_V2_GRAPH_CANDIDATE_ERROR_CODES.INPUT_INVALID,
    }))
  })

  test('rejects null-versus-empty duplicated project identity', () => {
    const graph = makeGraph({ projectId: '' })
    graph.scope.projectId = null
    graph.graphHash = graphHashFor(graph)
    expectInvalid(graph)
  })

  test.each(['projectId', 'outcomeId'])(
    'rejects matching empty optional identity: %s',
    (identityKey) => {
      const graph = makeGraph({ [identityKey]: '' })
      graph.scope[identityKey] = ''
      graph.graphHash = graphHashFor(graph)
      expectInvalid(graph)
    },
  )

  test('accepts canonical null project and outcome identities', () => {
    const graph = makeGraph({ projectId: null, outcomeId: null })
    graph.scope.projectId = null
    graph.scope.outcomeId = null
    graph.graphHash = graphHashFor(graph)
    expect(() => buildCandidate(graph)).not.toThrow()
  })

  test('rejects invalid authority identifiers', () => {
    const graph = makeGraph()
    expect(() => createRuntimeStateGraphCandidate({
      graph,
      scope,
      stateVersion,
      migrationReceiptId: 'not-an-object-id',
    })).toThrow(expect.objectContaining({
      code: RUNTIME_STATE_V2_GRAPH_CANDIDATE_ERROR_CODES.INPUT_INVALID,
    }))
  })

  test('rejects a node label outside the V2 schema bound', () => {
    const graph = makeGraph()
    graph.nodes[0].label = 'x'.repeat(1001)
    graph.graphHash = graphHashFor(graph)
    expect(() => buildCandidate(graph)).toThrow(expect.objectContaining({
      code: RUNTIME_STATE_V2_GRAPH_CANDIDATE_ERROR_CODES.SCHEMA_INVALID,
    }))
  })

  test.each([
    ['duplicate node identity', (graph) => { graph.nodes[1].nodeId = graph.nodes[0].nodeId }],
    ['duplicate edge identity', (graph) => { graph.edges.push({ ...graph.edges[0] }); graph.build.edgeCount = 2 }],
    ['node-edge identity collision', (graph) => { graph.edges[0].edgeId = graph.nodes[0].nodeId }],
    ['missing edge endpoint', (graph) => { graph.edges[0].toNodeId = 'missing:node' }],
  ])('rejects %s', (_label, mutate) => {
    const graph = makeGraph()
    mutate(graph)
    graph.graphHash = graphHashFor(graph)
    expectInvalid(graph)
  })

  test.each([
    ['node alias', (graph) => { graph.nodes[0].id = graph.nodes[0].nodeId }],
    ['edge alias', (graph) => { graph.edges[0].relationshipType = graph.edges[0].edgeType }],
    ['unknown node field', (graph) => { graph.nodes[0].rawPayload = 'forbidden' }],
    ['unknown edge field', (graph) => { graph.edges[0].rawPayload = 'forbidden' }],
  ])('rejects non-builder or unknown projection field: %s', (_label, mutate) => {
    const graph = makeGraph()
    mutate(graph)
    graph.graphHash = graphHashFor(graph)
    expectInvalid(graph)
  })
})
