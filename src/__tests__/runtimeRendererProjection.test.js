import { RUNTIME_INSTANCE_RENDERER_PROJECTION } from '../services/runtimeInstanceService.js'
import { buildDiscoveryProjection } from '../services/runtimeRendererService.js'

describe('runtime renderer persistence projection', () => {
  it('keeps bounded governed state while excluding legacy sections and the legacy graph', () => {
    const projectionFields = RUNTIME_INSTANCE_RENDERER_PROJECTION.split(' ')
    expect(projectionFields).toContain('framework_state.evidence_pack.inputs')
    expect(projectionFields).toContain('framework_state.evidence_pack.state')
    expect(projectionFields).not.toContain('framework_state.evidence_pack')
    expect(projectionFields).not.toContain('framework_state.evidence_pack.evidenceObjects')
    expect(projectionFields).not.toContain('framework_state.evidence_pack.sourceRegistry')
    expect(projectionFields).not.toContain('framework_state.evidence_pack.acquisition.sourceRegistry')
    expect(projectionFields).not.toContain('framework_state.evidence_pack.lineage.sources')
    expect(projectionFields).not.toContain('framework_state.evidence_pack.scoped_views')
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).toContain('evidence.dependencySnapshotHash')
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).toContain('stateVersion')
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).not.toContain('framework_state.sections')
    expect(RUNTIME_INSTANCE_RENDERER_PROJECTION).not.toContain('framework_state.intelligence_graph')
  })

  it('builds discovery controls from the bounded partial evidence projection without bulk fallback data', () => {
    const discovery = buildDiscoveryProjection({
      evidence_pack: {
        state: { status: 'EVIDENCE_READY' },
        inputs: {
          companyWebsite: 'https://acme.example',
          companyName: 'Acme',
          complete: true,
        },
        inputComplete: true,
        evidenceReady: true,
        accepted: false,
        acquisition: {
          profile: 'STANDARD',
          coverage: { score: 72 },
          confidence: 'SOURCE_BACKED',
          completedAt: '2026-08-29T10:00:00.000Z',
        },
        lineage: { builder: { mode: 'DETERMINISTIC' } },
        refreshedAt: '2026-08-29T10:00:00.000Z',
      },
    }, { includeInputValues: true })

    expect(discovery).toEqual(expect.objectContaining({
      inputComplete: true,
      evidenceReady: true,
      accepted: false,
      acquisitionProfile: 'STANDARD',
      inputValues: expect.objectContaining({
        companyWebsite: 'https://acme.example',
        companyName: 'Acme',
      }),
      scopedViews: {},
      sourceRegistrySummary: { count: 0, sourceTypes: [] },
      lineageSummary: { sourceCount: 0, builderMode: 'DETERMINISTIC' },
    }))
    expect(discovery.acquisition.sourceRegistry).toBeUndefined()
    expect(discovery).not.toHaveProperty('sourceRegistry')
    expect(discovery).not.toHaveProperty('evidenceObjects')
    expect(discovery).not.toHaveProperty('intelligenceGraph')
  })
})
