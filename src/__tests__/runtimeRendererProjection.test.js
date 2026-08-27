import { RUNTIME_INSTANCE_RENDERER_PROJECTION } from '../services/runtimeInstanceService.js'

describe('runtime renderer persistence projection', () => {
  it('keeps governed state while excluding full intelligence graph elements', () => {
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).toContain('framework_state.evidence_pack')
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).toContain('evidence.dependencySnapshotHash')
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).toContain('framework_state.sections')
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).toContain('framework_state.intelligence_graph.nodes.nodeType')
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).toContain('framework_state.intelligence_graph.edges.edgeType')
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).not.toContain('framework_state.intelligence_graph.nodes ')
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).not.toContain('framework_state.intelligence_graph.edges ')
  })
})
