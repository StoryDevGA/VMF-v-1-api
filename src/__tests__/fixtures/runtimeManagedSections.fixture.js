import { buildEnrichedGeneratedSection, hashSectionInput, normalizeRuntimeSectionObject } from '../../services/runtimeSectionModelService.js'
import { buildReasoningArtefactOutputs, resolvePackageReasoningArtefacts } from '../../services/reasoningArtefactContractService.js'
import { buildRuntimeManagedSourceReceipt } from '../../services/runtimeManagedSectionService.js'
import { buildAcceptedSectionTruth, validateGeneratedReasoningArtefactsForAcceptance } from '../../services/runtimeStateMutationService.js'

// Synthetic deterministic service fixture, not current imported seed equivalence.
// No database, provider, browser or release evidence.
export const FIXTURE_NOW = '2026-09-08T12:00:00.000Z'
export const VMF_GUIDED_SECTION_KEYS = ['customer_context', 'customer_problem', 'value_drivers', 'current_state_assessment', 'stakeholder_register', 'target_state']

export const makeRuntimeManagedFixture = ({ frameworkKey = 'VMF', completed = true } = {}) => {
  const guidedKeys = frameworkKey === 'VMF' ? VMF_GUIDED_SECTION_KEYS : ['survey_findings', 'risk_analysis']
  const hiddenKey = frameworkKey === 'VMF' ? 'output_requirements' : 'internal_compliance_packet'
  const sections = guidedKeys.map((sectionKey, index) => ({
    sectionKey, runtimePath: `framework_state.sections.${sectionKey}`, label: sectionKey,
    required: true, sectionMode: 'GUIDED',
    dependsOnSectionKeys: index ? [guidedKeys[index - 1]] : [],
  }))
  const reasoningArtefacts = sections.map((section, index) => {
    const artefactKey = frameworkKey === 'VMF' ? `guidedProof${index + 1}` : `assuranceRecord${index + 1}`
    return {
      artefactKey, label: artefactKey, purpose: `Internal completion proof for ${section.sectionKey}.`,
      required: true, lifecycleStage: 'GENERATED', sectionKeys: [section.sectionKey],
      workflowActionKeys: ['GENERATE_SECTION'], sourcePath: `reasoningArtefacts.${artefactKey}`,
      writePath: `${section.runtimePath}.generated.reasoningArtefacts.${artefactKey}`,
      schema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string', minLength: 1 } } },
      validation: { currentnessFields: ['packageVersion', 'inputHash', 'evidenceHash', 'dependencyHash', 'sectionContractHash', 'generatedAt'], maxBytes: 4096 },
      handoff: { eligible: true, mappingKey: artefactKey, targetPath: `outcome_studio.intermediate_reasoning.${artefactKey}` },
    }
  })
  const managedSection = {
    sectionKey: hiddenKey, runtimePath: `framework_state.sections.${hiddenKey}`, label: hiddenKey,
    required: true, sectionMode: 'RUNTIME_MANAGED', runtimeRole: frameworkKey === 'VMF' ? 'OUTPUT' : 'INTERNAL',
    runtimeManagedCompletion: { sourceSectionKeys: [...guidedKeys], reasoningArtefactKeys: reasoningArtefacts.map((item) => item.artefactKey) },
  }
  const frameworkPackage = {
    _id: 'fixture-package', frameworkKey, packageKey: `${frameworkKey.toLowerCase()}-ss022-fixture`, version: '1.0.0',
    dependencyLock: { snapshotId: 'fixture-dependency-snapshot', snapshotHash: hashSectionInput('dependencies') },
    sections: [...sections, managedSection], reasoningArtefacts,
  }
  const evidenceObjects = guidedKeys.map((sectionKey, index) => ({
    evidenceObjectId: `evidence_${index + 1}`, sourceId: `source_${index + 1}`, lineageRef: `lineage:${index + 1}`,
    reviewStatus: 'ACCEPTED', extractedFact: `Customer research confirms ${sectionKey} operating requirements and measurable delivery evidence.`,
    coverageArea: sectionKey, category: 'Proof',
  }))
  const frameworkState = {
    sections: Object.fromEntries(sections.map((section) => [section.sectionKey, normalizeRuntimeSectionObject({
      value: { objective: `Interpret the accepted evidence for ${section.sectionKey}.` },
      sectionKey: section.sectionKey, runtimePath: section.runtimePath, initializedAt: '2026-09-08T08:00:00.000Z',
    })])),
    evidence_pack: { accepted: true, acceptedAt: '2026-09-08T08:00:00.000Z', evidenceObjects, inputs: { researchScope: frameworkKey } },
    lifecycle: { stage: 'DRAFT' },
  }
  const runtimeInstance = {
    _id: 'fixture-runtime', runtimeInstanceKey: `${frameworkKey.toLowerCase()}-ss022`, runtimeType: 'VALUE_NARRATIVE',
    frameworkKey, packageId: frameworkPackage._id, packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version,
    status: 'ACTIVE', executionStatus: 'IDLE', framework_state: frameworkState,
    evidence: { activationId: 'fixture-activation', deploymentId: 'fixture-deployment', dependencySnapshotId: frameworkPackage.dependencyLock.snapshotId, dependencySnapshotHash: frameworkPackage.dependencyLock.snapshotHash },
  }
  const knowledgeContext = {
    contractVersion: 'oes-004-resolved-knowledge-context.v1', contextId: 'fixture-knowledge-context', status: 'READY', available: true,
    requestedOutputTypeKey: 'fixture-brief', outputType: { key: 'fixture-brief' }, outputSchema: { key: 'fixture-schema' },
    style: { key: 'fixture-style' }, renderer: { capabilityKey: 'fixture-brief', capabilityVersion: '1' },
    lineage: { contentHashes: ['sha256:fixture-knowledge'] },
  }
  const packs = [{ packType: 'ARL', packKey: 'fixture-reasoning', runtimeBindable: true, status: 'ACTIVE' }]
  const packBinding = { status: 'PROJECTED', mode: 'REGISTRY', resolutionSource: 'OUTCOME_KNOWLEDGE_PACK_REGISTRY', policyKey: 'outcome-studio', policyVersion: 'v1', requiredPacks: packs, activePacks: packs }
  const fixture = { frameworkPackage, frameworkState, runtimeInstance, knowledgeContext, packBinding, guidedKeys: [...guidedKeys], hiddenKey, managedSection }
  if (completed) sections.forEach((section, index) => generateAndAcceptFixtureSection(fixture, section.sectionKey, index))
  return fixture
}

export const generateAndAcceptFixtureSection = (fixture, sectionKey, index = 0) => {
  const { frameworkPackage, frameworkState, runtimeInstance } = fixture
  const section = frameworkPackage.sections.find((item) => item.sectionKey === sectionKey)
  const value = frameworkState.sections[sectionKey]
  const generatedAt = new Date(Date.parse('2026-09-08T09:00:00.000Z') + index * 120000).toISOString()
  const sectionContractHash = hashSectionInput(section)
  const { generated } = buildEnrichedGeneratedSection({
    actionKey: 'GENERATE_SECTION', actorUserId: 'fixture-user', frameworkPackage, frameworkState,
    input: value.input, runtimeInstance, section, dependencySectionKeys: section.dependsOnSectionKeys,
    sectionExecutionContract: { contractVersion: 'section-execution-contract-v1', sectionContractHash }, generatedAt,
  })
  const declarations = resolvePackageReasoningArtefacts({ frameworkPackage, sectionKey, actionKey: 'GENERATE_SECTION' })
  const candidate = { reasoningArtefacts: Object.fromEntries(declarations.map((item) => [item.artefactKey, { value: `Derived completion proof for ${sectionKey}.` }])) }
  const outputs = buildReasoningArtefactOutputs({
    candidate, declarations, packageKey: frameworkPackage.packageKey, packageVersion: frameworkPackage.version,
    sectionKey, stateSectionKey: sectionKey, inputHash: generated.inputHash, evidenceHash: generated.evidenceHash,
    dependencyHash: generated.dependencyHash, sectionContractHash, generatedAt,
  })
  generated.reasoningArtefacts = outputs.values
  generated.reasoningArtefactReceipts = outputs.receipts
  generated.runtimeManagedSourceReceipt = buildRuntimeManagedSourceReceipt({ frameworkPackage, frameworkState, section, generated })
  validateGeneratedReasoningArtefactsForAcceptance({ frameworkPackage, generated, sectionKey, stateSectionKey: sectionKey })
  value.generated = generated
  value.accepted = buildAcceptedSectionTruth({ actorUserId: 'fixture-user', generated, sectionKey, runtimePath: section.runtimePath, acceptedAt: new Date(Date.parse(generatedAt) + 60000).toISOString() })
  value.state = { status: 'ACCEPTED', needsRegeneration: false }
  value.review = { status: 'ACCEPTED' }
  return value
}
