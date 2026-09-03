import { RUNTIME_INSTANCE_RENDERER_PROJECTION } from '../services/runtimeInstanceService.js'
import { buildDiscoveryProjection, buildRendererFrameworkState, buildRendererSections } from '../services/runtimeRendererService.js'
import { __testables } from '../services/runtimeStateRepository.js'
import { evaluateRuntimeSectionTruthReadiness } from '../services/runtimeSectionTruthReadinessService.js'
import { getRuntimeActionStateGate } from '../services/runtimeActionPolicyService.js'
import { hashSectionInput } from '../services/runtimeSectionModelService.js'

describe('runtime renderer persistence projection', () => {
  const compactSection = (detail) => {
    const include = (value, paths) => {
      if (paths.some((path) => path.length === 0)) return value
      if (Array.isArray(value)) return value.map((entry) => include(entry, paths))
      if (value === null || typeof value !== 'object') return value
      return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
        const childPaths = paths.filter((path) => path[0] === key).map((path) => path.slice(1))
        return childPaths.length ? [[key, include(child, childPaths)]] : []
      }))
    }
    return include({ sectionDetail: JSON.parse(JSON.stringify(detail)) },
      Object.keys(__testables.RUNTIME_STATE_V2_RENDERER_SECTION_PROJECTION).map((path) => path.split('.'))).sectionDetail
  }

  it.each([
    'current', 'missing metadata', 'unequal content', 'changed input', 'invalidated evidence',
    'missing dependency', 'newer dependency', 'validation blocked', 'rejected truth', 'null generated',
  ])('preserves full versus summary gates, compare, dependencies and actions: %s', (scenario) => {
    const input = 'Customer context'
    const generatedAt = '2026-09-01T10:00:00.000Z'
    const generated = {
      content: 'Canonical narrative', generatedAt, inputHash: hashSectionInput(input),
      truthEligibility: { eligible: true },
      sectionIntelligence: { sectionNarrative: 'Rich narrative' }, sections: [{ body: 'Rich narrative' }],
    }
    const accepted = {
      ...generated, acceptedAt: generatedAt, sourceGeneratedAt: generatedAt,
    }
    const detail = {
      input, generated, accepted, state: { status: 'ACCEPTED' }, review: { status: 'ACCEPTED' },
      dependencies: {}, lineage: {}, validation: {},
      revisions: [{ revisionNumber: 1, generated: { ...generated, content: 'Previous' }, accepted }],
      intelligence: { displayProjection: { generatedInsight: { sections: generated.sections } } },
      additionalEvidence: { status: 'ACCEPTED' }, evidenceObjects: [{ evidenceObjectId: 'e1', reviewStatus: 'ACCEPTED' }],
    }
    const upstream = structuredClone(detail)
    if (scenario === 'missing metadata' || scenario === 'unequal content') {
      delete generated.generatedAt
      delete generated.inputHash
      delete accepted.sourceGeneratedAt
      delete accepted.inputHash
      if (scenario === 'unequal content') accepted.content = 'Different accepted narrative'
    }
    if (scenario === 'changed input') detail.input = 'Changed input'
    if (scenario === 'invalidated evidence') detail.state = { status: 'ACCEPTED', needsRegeneration: true, acceptedInvalidationReason: 'SECTION_EVIDENCE_CHANGED' }
    if (scenario === 'missing dependency') upstream.accepted = null
    if (scenario === 'newer dependency') upstream.accepted.acceptedAt = '2026-09-02T10:00:00.000Z'
    if (scenario === 'rejected truth') {
      detail.accepted = null
      detail.review.status = 'REJECTED'
      detail.generated.truthEligibility = { eligible: false, reason: 'INSUFFICIENT_EVIDENCE' }
      detail.evidenceObjects[0].reviewStatus = 'REJECTED'
    }
    if (scenario === 'null generated') detail.generated = null
    const frameworkPackage = { sections: [
      { sectionKey: 'downstream', runtimePath: 'framework_state.sections.downstream', required: true, dependsOnSectionKeys: ['upstream'], validationKeys: ['check'] },
      { sectionKey: 'upstream', runtimePath: 'framework_state.sections.upstream', required: true },
    ] }
    const runtimeInstance = { status: 'ACTIVE', executionStatus: 'IDLE', runtimeType: 'VALUE_NARRATIVE', updatedAt: generatedAt }
    const full = {
      lifecycle: { stage: 'DRAFT' }, readiness: { state: 'READY' },
      validation: { check: { is_valid: scenario !== 'validation blocked', message: 'Validation result' } },
      sections: { downstream: detail, upstream },
    }
    const compact = buildRendererFrameworkState({
      runtimeInstance: { framework_state: full },
      rendererState: { sections: Object.entries(full.sections).map(([sectionKey, value]) => ({
        sectionKey, projectionScope: 'RENDERER_SUMMARY', rendererSummary: compactSection(value),
      })) },
    })
    expect(evaluateRuntimeSectionTruthReadiness({ frameworkPackage, frameworkState: compact }))
      .toEqual(evaluateRuntimeSectionTruthReadiness({ frameworkPackage, frameworkState: full }))
    for (const actionKey of ['RUN_VALIDATION', 'MARK_READY', 'PUBLISH', 'LOCK_RECORD', 'GENERATE_SECTION', 'REGENERATE_SECTION']) {
      expect(getRuntimeActionStateGate({ actionKey, frameworkPackage, runtimeInstance, frameworkState: compact }))
        .toEqual(getRuntimeActionStateGate({ actionKey, frameworkPackage, runtimeInstance, frameworkState: full }))
    }
    const render = (frameworkState, projectionScope) => buildRendererSections({
      frameworkState, projectionScope, frameworkPackage, runtimeInstance,
      discovery: { accepted: true }, mutationAccess: { allowed: true }, configWarnings: [],
      uiContract: { sections: [] },
      runtimePathRecords: new Map(frameworkPackage.sections.map((section) => [section.runtimePath, { allowedOperations: ['READ', 'WRITE'], dataType: 'OBJECT' }])),
    })
    const fullRendered = render(full)
    const compactRendered = render(compact, 'RENDERER_SUMMARY')
    compactRendered.forEach((section, index) => {
      for (const key of ['compare', 'dependency', 'readiness', 'confidence', 'generationEligibility', 'state', 'review', 'lineage', 'sectionEvidence', 'validationMessages']) {
        expect(section[key]).toEqual(fullRendered[index][key])
      }
      expect(section.intelligence.metrics).toEqual(fullRendered[index].intelligence.metrics)
      expect(section.intelligence).not.toHaveProperty('displayProjection')
      if (section.generated) expect(section.generated).not.toHaveProperty('sectionIntelligence')
      expect(section.generated?.content).toEqual(fullRendered[index].generated?.content)
      expect(section.generated?.truthEligibility).toEqual(fullRendered[index].generated?.truthEligibility)
    })
  })
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

  it('retains persisted V2 section detail when reconstructing renderer state', () => {
    const sectionDetail = {
      input: 'Customer problem context',
      generated: { content: 'Generated customer problem' },
      accepted: { content: 'Accepted customer problem' },
      state: { status: 'GENERATED', stateVersion: 'runtime-revision:1' },
    }

    const frameworkState = buildRendererFrameworkState({
      runtimeInstance: {
        framework_state: { lifecycle: { stage: 'DRAFT' } },
      },
      rendererState: {
        sections: [{
          sectionKey: 'customer-problem',
          sectionDetail,
        }],
      },
    })

    expect(frameworkState).toEqual(expect.objectContaining({
      lifecycle: { stage: 'DRAFT' },
      sections: {
        'customer-problem': sectionDetail,
        customer_problem: sectionDetail,
      },
    }))
  })
})
