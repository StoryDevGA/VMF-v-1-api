import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { hasCurrentIndividualPackMetadataGuidance } from '../services/outcomeStudioIndividualContractService.js'
import { buildIntermediateReasoningManifest } from '../services/outcomeStudioEvidenceCompositionService.js'
import { resolveOutcomeRendererCapability } from '../services/outcomeRendererCapabilityRegistryService.js'

const resolveBinding = jest.fn()
jest.unstable_mockModule('../services/outcomeKnowledgePackRegistryService.js', () => ({
  resolveOutcomeStudioKnowledgePackBinding: resolveBinding,
}))
const { resolveOutcomeStudioKnowledgeContext, projectOutcomeStudioDeliverableDiscovery } =
  await import('../services/outcomeStudioKnowledgeContextService.js')

const pack = (capabilityKey) => ({
  capabilityKey, semanticVersion: '1.0.0', status: 'ACTIVE',
  activationId: `activation-${capabilityKey}`, versionId: `version-${capabilityKey}`,
  contentHash: `sha256:${capabilityKey}`, dependencyReferences: [],
  scopeType: 'GLOBAL', scopeKey: 'GLOBAL',
})
const fixture = () => {
  const type = pack('board-paper')
  const schema = pack('decision-schema')
  Object.assign(type, { knowledgeAssetId: 'OT-023', packType: 'OUTPUT_TYPE_DEFINITION', knowledgeLayer: 'OUTPUT_TYPE' })
  Object.assign(schema, { knowledgeAssetId: 'OSC-025', packType: 'OUTPUT_SCHEMA', knowledgeLayer: 'OUTPUT_SCHEMA' })
  type.dependencyReferences = [{
    relationshipType: 'REQUIRED_AT_RUNTIME', targetKnowledgeAssetId: 'OSC-025',
    requiredAt: 'RUNTIME', cardinality: 'ONE',
  }]
  return {
    status: 'READY', policyKey: 'outcome-studio-v1-required-packs', policyVersion: '2.0.0',
    selectedByLayer: { OUTPUT_TYPE: [type], OUTPUT_SCHEMA: [schema] },
    dependencyGraph: { edges: [{
      from: type.activationId, to: schema.activationId,
      relationshipType: 'REQUIRED_AT_RUNTIME', requiredAt: 'RUNTIME', cardinality: 'ONE',
    }] },
    resolution: { scopeCandidates: [{ scopeType: 'GLOBAL', scopeKey: 'GLOBAL', precedence: 0 }] },
    lineage: {
      activationIds: [type.activationId, schema.activationId],
      versionIds: [type.versionId, schema.versionId],
      contentHashes: [type.contentHash, schema.contentHash], resolvedAt: '2026-09-16T12:00:00Z',
    },
    missingDependencies: [], relationshipFailures: [], ambiguousCandidates: [],
  }
}
let binding
beforeEach(() => {
  binding = fixture()
  resolveBinding.mockReset().mockImplementation(async () => ({ binding }))
})
const resolve = () => resolveOutcomeStudioKnowledgeContext({ query: { requestedOutputTypeKey: 'board-paper' } })

describe('individual contract metadata is separate from executable composition', () => {
  test('builds lineage-bound metadata without an optional Style pack', async () => {
    const { context } = await resolve()
    expect(context.available).toBe(true)
    expect(context.style).toBeNull()
    expect(context.outputSpecificCompositionGuidance).toEqual(expect.objectContaining({
      status: 'RESOLVED_METADATA', contentValidated: false, generationEligible: false,
    }))
    expect(hasCurrentIndividualPackMetadataGuidance(context)).toBe(true)
    expect(context.renderer.generationEligible).toBe(false)
    const discovery = projectOutcomeStudioDeliverableDiscovery(binding)
    expect(discovery.available.map((entry) => entry.key)).toEqual(['board-paper'])
  })

  test.each(['BLOCKED', 'AMBIGUOUS'])('does not mint a receipt for %s resolution', async (status) => {
    binding.status = status
    expect((await resolve()).context.available).toBe(false)
  })

  test.each(['activationId', 'versionId', 'contentHash', 'semanticVersion'])('missing %s fails closed', async (field) => {
    delete binding.selectedByLayer.OUTPUT_SCHEMA[0][field]
    expect((await resolve()).context.available).toBe(false)
  })

  test('inactive selection cannot mint a receipt', async () => {
    binding.selectedByLayer.OUTPUT_SCHEMA[0].status = 'DEPRECATED'
    expect((await resolve()).context.available).toBe(false)
  })

  test('lineage drift cannot mint a receipt', async () => {
    binding.lineage.versionIds = []
    expect((await resolve()).context.available).toBe(false)
  })

  test('ambiguous optional style is not silently discarded', async () => {
    binding.selectedByLayer.STYLE = [pack('style-a'), pack('style-b')]
    expect((await resolve()).context.available).toBe(false)
  })

  test('explicit required Style failure remains blocked', async () => {
    binding.status = 'BLOCKED'
    binding.missingDependencies = [{ requirement: 'REQUIRED', selector: { knowledgeLayer: 'STYLE' } }]
    expect((await resolve()).context.blockerReason).toBe('STYLE_UNRESOLVED')
  })

  test.each(['schema', 'lineage', 'policy', 'receipt'])('rejects stale or tampered %s', async (field) => {
    const { context } = await resolve()
    if (field === 'schema') context.outputSchema.version = '2.0.0'
    if (field === 'lineage') context.lineage.contentHashes.push('changed')
    if (field === 'policy') context.resolutionEvidence.policy.version = 'changed'
    if (field === 'receipt') context.outputSpecificCompositionGuidance.contextHash = 'invalid'
    expect(hasCurrentIndividualPackMetadataGuidance(context)).toBe(false)
  })

  test('handoff consumes metadata receipt but content-generation manifest does not', async () => {
    const { context } = await resolve()
    const input = {
      frameworkHandoff: { sectionTruth: [], reasoningArtefactsContractActive: true, reasoningArtefactDeclarations: [] },
      knowledgeContext: context, enforceMissing: false,
    }
    const handoff = buildIntermediateReasoningManifest({ ...input, metadataOnly: true })
    expect(handoff.manifest.artefacts).toContainEqual(expect.objectContaining({
      key: 'outputSpecificCompositionGuidance', present: true, metadataOnly: true, contentValidated: false,
    }))
    expect(buildIntermediateReasoningManifest(input).manifest.status).toBe('BLOCKED')
    expect(() => buildIntermediateReasoningManifest({ ...input, enforceMissing: true })).toThrow()
  })

  test('metadata renderer lookup does not relax the generation renderer default', () => {
    const selectors = { outputTypeKey: 'board-paper', outputSchemaKey: 'decision-schema' }
    expect(resolveOutcomeRendererCapability({ ...selectors, metadataOnly: true }).status).toBe('SUPPORTED')
    expect(resolveOutcomeRendererCapability(selectors)).toEqual(expect.objectContaining({
      status: 'UNSUPPORTED', reason: 'REQUIRED_DELIVERABLE_BINDING_MISSING',
    }))
  })

  test.each(['missing declaration', 'missing edge', 'schema reached from ARL'])('%s cannot prove Type-to-Schema binding', async (fault) => {
    if (fault === 'missing declaration') binding.selectedByLayer.OUTPUT_TYPE[0].dependencyReferences = []
    if (fault === 'missing edge') binding.dependencyGraph.edges = []
    if (fault === 'schema reached from ARL') binding.dependencyGraph.edges[0].from = 'activation-arl'
    expect((await resolve()).context.available).toBe(false)
  })

  test.each(['reciprocal', 'direct'])('accepts canonical %s compatible Schema evidence', async (pattern) => {
    const type = binding.selectedByLayer.OUTPUT_TYPE[0]
    const schema = binding.selectedByLayer.OUTPUT_SCHEMA[0]
    type.dependencyReferences = [{
      relationshipType: 'REQUIRES_COMPATIBLE_PACK', targetPackType: 'OUTPUT_SCHEMA',
      requiredAt: 'RUNTIME', cardinality: 'ONE_OR_MORE',
    }]
    Object.assign(binding.dependencyGraph.edges[0], {
      relationshipType: 'REQUIRES_COMPATIBLE_PACK', cardinality: 'ONE_OR_MORE',
    })
    if (pattern === 'reciprocal') schema.dependencyReferences = [{
      relationshipType: 'COMPATIBLE_WITH', targetKnowledgeAssetId: 'OT-023',
      requiredAt: 'NONE', cardinality: 'ZERO_OR_MORE',
    }]
    else schema.compatibleOutputTypes = ['board-paper']
    expect(hasCurrentIndividualPackMetadataGuidance((await resolve()).context)).toBe(true)
    if (pattern === 'reciprocal') schema.dependencyReferences[0].targetKnowledgeAssetId = 'OT-999'
    else schema.compatibleOutputTypes = ['unrelated']
    expect((await resolve()).context.available).toBe(false)
  })

  test('rejects a replaced binding hash with valid SHA-256 format', async () => {
    const { context } = await resolve()
    context.outputSpecificCompositionGuidance.bindingHash = 'a'.repeat(64)
    expect(hasCurrentIndividualPackMetadataGuidance(context)).toBe(false)
  })

  test.each(['scope', 'pack scope', 'relationship', 'activation', 'version', 'content'])('rejects an old receipt after %s drift', async (field) => {
    const original = (await resolve()).context
    const schema = binding.selectedByLayer.OUTPUT_SCHEMA[0]
    if (field === 'scope') binding.resolution.scopeCandidates.push({ scopeType: 'TENANT', scopeKey: 'TENANT:private', precedence: 5 })
    if (field === 'pack scope') schema.scopeKey = 'TENANT:private'
    if (field === 'relationship') {
      binding.selectedByLayer.OUTPUT_TYPE[0].dependencyReferences[0].versionConstraint = { minimumVersionInclusive: '1.0.0' }
      binding.dependencyGraph.edges[0].versionConstraint = { minimumVersionInclusive: '1.0.0' }
    }
    if (field === 'activation') {
      schema.activationId = 'replacement-activation'
      binding.lineage.activationIds[1] = schema.activationId
      binding.dependencyGraph.edges[0].to = schema.activationId
    }
    if (field === 'version') {
      schema.versionId = 'replacement-version'
      binding.lineage.versionIds[1] = schema.versionId
    }
    if (field === 'content') {
      schema.contentHash = 'sha256:replacement-content'
      binding.lineage.contentHashes[1] = schema.contentHash
    }
    const current = (await resolve()).context
    expect(hasCurrentIndividualPackMetadataGuidance(current)).toBe(true)
    expect(current.outputSpecificCompositionGuidance.bindingHash).not.toBe(original.outputSpecificCompositionGuidance.bindingHash)
    current.outputSpecificCompositionGuidance.bindingHash = original.outputSpecificCompositionGuidance.bindingHash
    expect(hasCurrentIndividualPackMetadataGuidance(current)).toBe(false)
    current.outputSpecificCompositionGuidance = original.outputSpecificCompositionGuidance
    expect(hasCurrentIndividualPackMetadataGuidance(current)).toBe(false)
    expect(JSON.stringify(current.resolutionEvidence)).not.toContain('TENANT:private')
    expect(JSON.stringify(current.resolutionEvidence)).not.toContain('replacement-activation')
  })

  test.each(['BLOCKED', 'AMBIGUOUS'])('discovery preserves %s aggregate status despite ACTIVE selected packs', (status) => {
    binding.status = status
    expect(projectOutcomeStudioDeliverableDiscovery(binding).available).toEqual([])
    binding.availableOutputTypes = [{
      status: 'READY', capabilityKey: 'board-paper',
      outputType: binding.selectedByLayer.OUTPUT_TYPE[0], outputSchema: binding.selectedByLayer.OUTPUT_SCHEMA[0],
    }]
    expect(projectOutcomeStudioDeliverableDiscovery(binding).available).toEqual([])
  })

  test.each(['BLOCKED', 'AMBIGUOUS'])('discovery preserves %s entry status in a PROJECTED aggregate', (status) => {
    binding.status = 'PROJECTED'
    binding.availableOutputTypes = [{
      status, capabilityKey: 'board-paper',
      outputType: binding.selectedByLayer.OUTPUT_TYPE[0], outputSchema: binding.selectedByLayer.OUTPUT_SCHEMA[0],
    }]
    expect(projectOutcomeStudioDeliverableDiscovery(binding).available).toEqual([])
  })

  test.each(['aggregate', 'entry'])('discovery rejects %s required dependencies even with READY status', (level) => {
    binding.availableOutputTypes = [{
      status: 'READY', capabilityKey: 'board-paper',
      outputType: binding.selectedByLayer.OUTPUT_TYPE[0], outputSchema: binding.selectedByLayer.OUTPUT_SCHEMA[0],
    }]
    const target = level === 'aggregate' ? binding : binding.availableOutputTypes[0]
    target.missingDependencies = [{ requirement: 'REQUIRED', selector: { knowledgeLayer: 'STYLE' } }]
    expect(projectOutcomeStudioDeliverableDiscovery(binding).available).toEqual([])
  })

  test('discovery rejects ambiguous optional Style with otherwise complete valid lineage', async () => {
    const styles = [pack('style-a'), pack('style-b')]
    binding.selectedByLayer.STYLE = styles
    for (const style of styles) {
      binding.lineage.activationIds.push(style.activationId)
      binding.lineage.versionIds.push(style.versionId)
      binding.lineage.contentHashes.push(style.contentHash)
    }
    expect((await resolve()).context.available).toBe(false)
    expect(projectOutcomeStudioDeliverableDiscovery(binding).available).toEqual([])
  })

  test('PROJECTED discovery requires ready entries and honors nested aggregate failures', () => {
    binding.status = 'PROJECTED'
    binding.availableOutputTypes = [{
      status: 'READY', capabilityKey: 'board-paper',
      outputType: binding.selectedByLayer.OUTPUT_TYPE[0], outputSchema: binding.selectedByLayer.OUTPUT_SCHEMA[0],
      style: null,
    }]
    expect(projectOutcomeStudioDeliverableDiscovery(binding).availableCount).toBe(1)
    binding.resolution.status = 'BLOCKED'
    expect(projectOutcomeStudioDeliverableDiscovery(binding).availableCount).toBe(0)
    binding.resolution.status = 'PROJECTED'
    binding.availableOutputTypes[0].ambiguousCandidates = [{ selector: { knowledgeLayer: 'STYLE' }, candidates: [pack('a'), pack('b')] }]
    expect(projectOutcomeStudioDeliverableDiscovery(binding).availableCount).toBe(0)
  })
})
