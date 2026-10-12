import { expect, test } from '@jest/globals'
import { buildRuntimeIntelligenceGraphForFrameworkState, hashRuntimeIntelligenceGraphValue } from '../services/runtimeIntelligenceGraphService.js'
import { createRuntimeStateGraphCandidate } from '../services/runtimeStateGraphCandidateService.js'

const scope = {
  runtimeInstanceId: '64b000000000000000000001', runtimeInstanceKey: 'runtime-one',
  customerId: '64b000000000000000000002', tenantId: '64b000000000000000000003',
}
const accepted = {
  truthHash: `sha256:${'a'.repeat(64)}`, acceptedAt: '2026-10-10T12:00:00.000Z',
  acceptedBy: scope.customerId, content: 'Synthetic accepted understanding',
}
const evidence = {
  evidenceObjectId: 'evidence-one', sourceId: 'source-one', category: 'Company',
  extractedFact: 'Synthetic recorded fact', reviewStatus: 'ACCEPTED',
}
const build = ({ sections = { customer_context: { accepted } }, packageSections = [{
  sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context',
}], sectionEvidence = false } = {}) => buildRuntimeIntelligenceGraphForFrameworkState({
  runtimeInstance: { ...scope, _id: scope.runtimeInstanceId, runtimeType: 'VALUE_NARRATIVE', frameworkId: '64b000000000000000000005' },
  frameworkPackage: { frameworkKey: 'FIXTURE', packageKey: 'fixture', version: '1', sections: packageSections },
  frameworkState: {
    sections,
    evidence_pack: {
      sourceRegistry: [{ sourceId: 'source-one', sourceType: 'UPLOADED_DOCUMENT' }],
      evidenceObjects: sectionEvidence ? [] : [evidence],
      scoped_views: sectionEvidence ? {} : { 'customer-context': { evidenceObjectIds: ['evidence-one'] } },
    },
  },
  builtAt: '2026-10-10T12:00:00.000Z',
  actorUserId: scope.customerId,
})
const truth = graph => graph.nodes.filter(n => n.nodeType === 'SECTION_TRUTH')
const candidate = graph => createRuntimeStateGraphCandidate({
  graph, scope, stateVersion: 'rsv2:12345678-1234-4123-8123-123456789abc',
  migrationReceiptId: '64b000000000000000000004',
})

test('follows the declared runtime path and retains the package identity and connected provenance', () => {
  const sections = { customer_context: { accepted }, 'customer-context': { accepted: { ...accepted, truthHash: 'wrong-truth' } } }
  const before = structuredClone(sections)
  const graph = build({ sections })
  expect(truth(graph)).toHaveLength(1)
  expect(truth(graph)[0]).toMatchObject({ sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context', truthHash: accepted.truthHash, acceptedAt: accepted.acceptedAt, acceptedBy: accepted.acceptedBy })
  expect(sections).toEqual(before)
  const edges = graph.edges.filter(e => ['SOURCE_PRODUCES_EVIDENCE', 'EVIDENCE_DERIVES_INTELLIGENCE', 'INTELLIGENCE_SUPPORTS_SECTION_TRUTH'].includes(e.edgeType))
  expect(edges).toHaveLength(3)
  const support = edges.find(e => e.edgeType === 'INTELLIGENCE_SUPPORTS_SECTION_TRUTH')
  const derived = edges.find(e => e.toNodeId === support.fromNodeId)
  expect(edges.some(e => e.toNodeId === derived.fromNodeId)).toBe(true)
  const graphBefore = structuredClone(graph)
  const result = candidate(graph)
  expect(result.nodes.find(n => n.elementKey === truth(graph)[0].nodeId).attributes).toMatchObject({
    truthHash: accepted.truthHash, acceptedAt: accepted.acceptedAt, acceptedBy: accepted.acceptedBy,
  })
  expect(result.snapshot.graphHash).toBe(graph.graphHash)
  expect(graph).toEqual(graphBefore)
})

test('maps an authentic exact-key producer graph through native candidate validation', () => {
  const graph = build({ sections: { 'customer-context': { accepted } }, packageSections: [{ sectionKey: 'customer-context' }] })
  expect(truth(graph)).toHaveLength(1)
  expect(candidate(graph).counts.nodeCount).toBe(graph.nodes.length)
})

test('connects evidence stored under the declared runtime state key', () => {
  const graph = build({ sections: { customer_context: { accepted, evidenceObjects: [evidence] } }, sectionEvidence: true })
  expect(graph.edges.filter(e => e.edgeType === 'INTELLIGENCE_SUPPORTS_SECTION_TRUTH')).toHaveLength(1)
})

test('does not invent accepted truth from generated drafts or guessed key aliases', () => {
  expect(truth(build({ sections: { customer_context: { generated: accepted } } }))).toEqual([])
  expect(truth(build({ packageSections: [{ sectionKey: 'customer-context' }] }))).toEqual([])
})

test.each([
  ['unknown', n => { n.unknownTruth = true }],
  ['unsafe', n => { n.acceptedBy = { constructor: 'unsafe' } }],
  ['oversized', n => { n.truthHash = 'x'.repeat(33 * 1024) }],
])('retains native strict validation for %s truth attributes', (_name, mutate) => {
  const graph = build({ sections: { 'customer-context': { accepted } }, packageSections: [{ sectionKey: 'customer-context' }] })
  mutate(truth(graph)[0])
  graph.graphHash = hashRuntimeIntelligenceGraphValue({
    artifactType: graph.artifactType, graphVersion: graph.graphVersion,
    runtimeInstanceId: graph.runtimeInstanceId, scope: graph.scope, sourceHash: graph.build.sourceHash,
    nodes: graph.nodes, edges: graph.edges, registries: graph.registries, coverage: graph.coverage,
    dependencies: graph.dependencies, health: graph.health, validation: graph.validation,
  })
  // A directly validated DTO exercises the storage bound without relying on graph hash rejection.
  const clean = candidate(build({ sections: { 'customer-context': { accepted } }, packageSections: [{ sectionKey: 'customer-context' }] }))
  const node = clean.nodes.find(n => n.attributes.nodeType === 'SECTION_TRUTH')
  mutate(node.attributes)
  expect(() => candidate(graph)).toThrow()
  return import('../models/RuntimeGraphElement.js').then(({ default: Model }) => {
    expect(new Model(node).validateSync()).toBeDefined()
  })
})
