import { describe, expect, test } from '@jest/globals'
import { buildRuntimeIntelligenceGraphForFrameworkState } from '../services/runtimeIntelligenceGraphService.js'

const evidence = (id, sourceId, domain = 'Company', reviewStatus = 'ACCEPTED') => ({
  evidenceObjectId: id, sourceId, category: domain, coverageArea: domain,
  extractedFact: 'Recorded customer fixture fact', reviewStatus,
})
const build = (sourceRegistry, evidenceObjects) => buildRuntimeIntelligenceGraphForFrameworkState({
  frameworkPackage: { frameworkKey: 'FIXTURE', packageKey: 'fixture', version: '1', sections: [] },
  frameworkState: { sections: {}, evidence_pack: { accepted: false, sourceRegistry, evidenceObjects } },
  runtimeInstance: { _id: 'fixture', runtimeInstanceKey: 'fixture', customerId: 'customer', tenantId: 'tenant' },
})
const facts = (graph, domain = 'Company') => graph.coverage.domains.find(row => row.domain === domain).sourceFacts
describe('recorded connected-source facts from the existing graph producer', () => {
  test('deduplicates recorded sources per domain without counting pending or rejected evidence', () => {
    const graph = build([{ sourceId: 'a', sourceType: 'WEBSITE' }, { sourceId: 'b', sourceType: 'UPLOADED_DOCUMENT' }],
      [evidence('a1', 'a'), evidence('a2', 'a'), evidence('b1', 'b'), evidence('a3', 'a', 'Proof'), evidence('p', 'b', 'Company', 'PENDING'), evidence('r', 'b', 'Company', 'REJECTED')])
    expect(facts(graph)).toEqual({ contractVersion: 'dig-connected-source-facts.v1', basis: 'RECORDED_CONNECTED_ACCEPTED_EVIDENCE', resolvedSourceCount: 2, unresolvedEvidenceCount: 0, sourceCompleteness: 'COMPLETE', unknownSourceTypeCount: 0, typeCompleteness: 'COMPLETE', sourceTypeCounts: [{ sourceType: 'UPLOADED_DOCUMENT', count: 1 }, { sourceType: 'WEBSITE', count: 1 }] })
    expect(facts(graph, 'Proof').resolvedSourceCount).toBe(1)
    expect(graph.coverage.domains.find(row => row.domain === 'Company').connectedEvidenceCount).toBe(3)
  })
  test('does not turn a synthetic evidence-source fallback into a recorded canonical source', () => {
    const graph = build([], [evidence('e', 'missing')])
    expect(facts(graph)).toMatchObject({ resolvedSourceCount: 0, unresolvedEvidenceCount: 1, sourceCompleteness: 'PARTIAL', sourceTypeCounts: [] })
  })
  test('rejects ambiguous colliding graph IDs and conflicting recorded source kinds', () => {
    const collision = build([{ sourceId: 'a_b', sourceType: 'WEBSITE' }, { sourceId: 'a-b', sourceType: 'WEBSITE' }], [evidence('a', 'a_b'), evidence('b', 'a-b')])
    expect(facts(collision).sourceCompleteness).toBe('PARTIAL')
    const conflict = build([{ sourceId: 'a', sourceType: 'WEBSITE' }, { sourceId: 'a', sourceType: 'UPLOADED_DOCUMENT' }], [evidence('a', 'a')])
    expect(facts(conflict)).toMatchObject({ resolvedSourceCount: 0, unresolvedEvidenceCount: 1 })
  })
  test('keeps unknown kinds distinct from absent source identities and zero-domain counts', () => {
    const graph = build([{ sourceId: 'a', sourceType: 'UNKNOWN' }], [evidence('a', 'a')])
    expect(facts(graph)).toMatchObject({ resolvedSourceCount: 1, unknownSourceTypeCount: 1, sourceTypeCounts: [], sourceCompleteness: 'COMPLETE' })
    expect(facts(graph, 'Proof')).toMatchObject({ resolvedSourceCount: 0, unresolvedEvidenceCount: 0, sourceCompleteness: 'COMPLETE', sourceTypeCounts: [] })
  })
  test('does not truncate more than twelve kinds into a complete distribution', () => {
    const sources = Array.from({ length: 13 }, (_, i) => ({ sourceId: `s${i}`, sourceType: `KIND_${i}` }))
    const graph = build(sources, sources.map((source, i) => evidence(`e${i}`, source.sourceId)))
    expect(facts(graph)).toMatchObject({ resolvedSourceCount: 13, typeCompleteness: 'PARTIAL', sourceTypeCounts: null })
  })
  test('binds changed recorded kinds to the graph hash and leaves the input unchanged', () => {
    const sources = [{ sourceId: 'a', sourceType: 'WEBSITE' }], objects = [evidence('a', 'a')]
    const before = structuredClone({ sources, objects }), first = build(sources, objects)
    expect({ sources, objects }).toEqual(before)
    const next = build([{ sourceId: 'a', sourceType: 'UPLOADED_DOCUMENT' }], objects)
    expect(next.graphHash).not.toBe(first.graphHash)
  })
})
